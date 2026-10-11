// Adding books: reads each file, pulls out title/author/cover and stores it.
import { DB } from './db.js';
import { uid, esc, downscaleImage, generateCover, canvasToBlob, naturalCompare, toast } from './util.js';

let pdfjsPromise;
export function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then(m => {
      m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return m;
    });
  }
  return pdfjsPromise;
}

export const IMAGE_RE = /\.(jpe?g|png|gif|webp|bmp)$/i;

const FORMATS = { epub: 'epub', pdf: 'pdf', txt: 'txt', text: 'txt', cbz: 'cbz', zip: 'cbz' };

function baseName(name) {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export async function importFiles(files, onProgress) {
  const added = [];
  const skipped = [];
  let i = 0;
  for (const file of files) {
    i++;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const format = FORMATS[ext];
    if (!format) { skipped.push(file.name); continue; }
    onProgress?.(`Adding ${i} of ${files.length}: ${file.name}`);
    try {
      const buf = await file.arrayBuffer();
      let info;
      if (format === 'epub') info = await readEpub(buf, file.name);
      else if (format === 'pdf') info = await readPdf(buf, file.name);
      else if (format === 'txt') info = await readTxt(buf, file.name);
      else info = await readComic(buf, file.name);
      const id = uid();
      const book = {
        id,
        title: info.title || baseName(file.name),
        author: info.author || '',
        format,
        fileName: file.name,
        size: file.size,
        added: Date.now(),
        lastOpened: 0,
        progress: 0,
        pos: null,
        status: 'unread',
        collections: [],
        cover: info.cover || await generateCover(info.title || baseName(file.name), info.author || '', format),
        pages: info.pages || 0
      };
      await DB.put('files', { id, blob: info.blob });
      await DB.put('books', book);
      added.push(book);
    } catch (err) {
      console.error(err);
      skipped.push(file.name + ' (could not be read)');
    }
  }
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
  return { added, skipped };
}

// ---------- EPUB ----------
async function readEpub(buf, name) {
  const blob = new Blob([buf], { type: 'application/epub+zip' });
  const book = window.ePub(buf.slice(0));
  try {
    await book.ready;
    const md = book.packaging?.metadata || {};
    let cover = null;
    try {
      const url = await book.coverUrl();
      if (url) cover = await downscaleImage(url);
    } catch { /* no cover */ }
    return { blob, title: clean(md.title) || baseName(name), author: clean(md.creator), cover };
  } finally {
    try { book.destroy(); } catch { /* ignore */ }
  }
}

function clean(s) { return (s || '').replace(/\s+/g, ' ').trim(); }

// ---------- PDF ----------
async function readPdf(buf, name) {
  const blob = new Blob([buf], { type: 'application/pdf' });
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf.slice(0)) }).promise;
  try {
    let title = '', author = '';
    try {
      const meta = await doc.getMetadata();
      title = clean(meta?.info?.Title);
      author = clean(meta?.info?.Author);
    } catch { /* ignore */ }
    // Many PDFs carry junk titles such as "Microsoft Word - file.docx".
    if (!title || /^(untitled|microsoft word|document\d*)/i.test(title) || /\.(docx?|pdf|indd)$/i.test(title)) title = baseName(name);
    let cover = null;
    try {
      const page = await doc.getPage(1);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 360 / vp1.width });
      const c = document.createElement('canvas');
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      cover = await canvasToBlob(c);
    } catch { /* ignore */ }
    return { blob, title, author, cover, pages: doc.numPages };
  } finally {
    doc.destroy();
  }
}

// ---------- Comics (CBZ) ----------
async function readComic(buf, name) {
  const blob = new Blob([buf], { type: 'application/zip' });
  const zip = await window.JSZip.loadAsync(buf);
  const pages = comicPages(zip);
  if (!pages.length) throw new Error('No images in archive');
  let cover = null;
  try { cover = await downscaleImage(await zip.file(pages[0]).async('blob')); } catch { /* ignore */ }
  return { blob, title: baseName(name), author: '', cover, pages: pages.length };
}

export function comicPages(zip) {
  return Object.keys(zip.files)
    .filter(n => !zip.files[n].dir && IMAGE_RE.test(n) && !/(^|\/)(__MACOSX|\.)/.test(n))
    .sort(naturalCompare);
}

// ---------- Plain text: converted to a simple EPUB so it gets every reading feature ----------
function decodeText(buf) {
  const bytes = new Uint8Array(buf);
  if (bytes[0] === 0xFF && bytes[1] === 0xFE) return new TextDecoder('utf-16le').decode(bytes);
  if (bytes[0] === 0xFE && bytes[1] === 0xFF) return new TextDecoder('utf-16be').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}

async function readTxt(buf, name) {
  const text = decodeText(buf).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const head = text.slice(0, 3000);
  const title = clean((head.match(/^\s*Title:\s*(.+)$/mi) || [])[1]) || baseName(name);
  const author = clean((head.match(/^\s*Author:\s*(.+)$/mi) || [])[1]);
  // Drop Project Gutenberg-style licence wrappers and metadata lines.
  let body = text;
  const start = body.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\n/i);
  if (start >= 0) body = body.slice(body.indexOf('\n', start) + 1);
  const end = body.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  if (end >= 0) body = body.slice(0, end);
  const lines = body.split('\n');
  for (let i = 0; i < Math.min(lines.length, 40); i++) {
    if (/^\s*(Title|Author|Release date|Language|Credits|Translator|Editor|Illustrator|Most recently updated|Original publication):/i.test(lines[i])) lines[i] = '';
  }
  const blob = await textToEpub(title, author, lines.join('\n'));
  return { blob, title, author, cover: null };
}

const HEAD_RE = /^(chapter|part|book|prologue|epilogue|preface|introduction|foreword|afterword|appendix)\b.{0,60}$|^[IVXLCDM]{1,7}\.?$|^\d{1,3}\.?$/i;

export async function textToEpub(title, author, text) {
  const lines = text.split('\n');
  const blank = lines.filter(l => !l.trim()).length;
  let paras;
  if (blank > lines.length * 0.05) {
    paras = text.split(/\n\s*\n/).map(p => p.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  } else {
    paras = lines.map(l => l.trim()).filter(Boolean);
  }
  let chapters = [];
  let cur = { title: null, paras: [] };
  const heads = paras.filter(p => p.length <= 70 && HEAD_RE.test(p)).length;
  const detect = heads > 1 && heads < paras.length * 0.2;
  for (const p of paras) {
    if (detect && p.length <= 70 && HEAD_RE.test(p)) {
      if (cur.paras.length || cur.title) chapters.push(cur);
      cur = { title: p, paras: [] };
    } else cur.paras.push(p);
  }
  if (cur.paras.length || cur.title) chapters.push(cur);
  // Keep sections short so pages stay fast on an older iPad.
  const MAX = 300;
  const split = [];
  let n = 1;
  for (const ch of chapters) {
    if (ch.paras.length <= MAX) { split.push({ title: ch.title || `Section ${n++}`, paras: ch.paras }); continue; }
    for (let i = 0; i < ch.paras.length; i += MAX) {
      const part = i / MAX + 1;
      split.push({ title: ch.title ? `${ch.title}${part > 1 ? ` (${part})` : ''}` : `Section ${n++}`, paras: ch.paras.slice(i, i + MAX), hideTitle: !!ch.title && part > 1 });
    }
  }
  chapters = split.length ? split : [{ title: 'Text', paras: ['(empty)'] }];

  const zip = new window.JSZip();
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const x = s => esc(s);
  chapters.forEach((ch, i) => {
    const showTitle = !ch.hideTitle && !/^Section \d+$/.test(ch.title);
    zip.file(`OEBPS/c${i + 1}.xhtml`, `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en"><head><title>${x(ch.title)}</title>
<style>p{margin:0;text-indent:1.4em}h2{text-align:center;margin:1.5em 0 1.2em;font-weight:600}h2+p{text-indent:0}</style></head>
<body>${showTitle ? `<h2>${x(ch.title)}</h2>` : ''}${ch.paras.map(p => `<p>${x(p)}</p>`).join('\n')}</body></html>`);
  });
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="c${i + 1}.xhtml">${x(c.title)}</a></li>`).join('')}</ol></nav></body></html>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">urn:uuid:${uid()}</dc:identifier><dc:title>${x(title)}</dc:title>${author ? `<dc:creator>${x(author)}</dc:creator>` : ''}<dc:language>en</dc:language><meta property="dcterms:modified">2026-01-01T00:00:00Z</meta></metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>${chapters.map((c, i) => `<item id="c${i + 1}" href="c${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest>
<spine>${chapters.map((c, i) => `<itemref idref="c${i + 1}"/>`).join('')}</spine></package>`);
  return zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip', compression: 'DEFLATE' });
}

export function reportImport({ added, skipped }) {
  if (added.length && !skipped.length) toast(added.length === 1 ? `Added “${added[0].title}”` : `Added ${added.length} books`);
  else if (added.length) toast(`Added ${added.length}. Skipped: ${skipped.join(', ')}`, { duration: 7000 });
  else if (skipped.length) toast(`Couldn't add: ${skipped.join(', ')}. Supported: EPUB, PDF, TXT, CBZ.`, { duration: 7000 });
}
