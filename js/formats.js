// The three page engines: reflowable books (EPUB and converted TXT), PDF, and comics (CBZ).
// Each one draws pages into the reader's stage and reports back to the shell:
//   shell.onLocation(loc)   after every page change
//   shell.tap(fraction)     tap at a horizontal position (0 = left edge, 1 = right edge)
//   shell.swipe(dir)        'left' or 'right' finger swipe
//   shell.onSelect(sel) / shell.onSelectClear()
//   shell.onHighlightTap(noteId)
import { loadPdfjs, comicPages } from './importer.js';
import { esc } from './util.js';

// ---------- Shared touch handling ----------
let lastTouch = 0;
function gestures(target, { onTap, swipe, hasSelection }) {
  let sx = null, sy = 0, st = 0, sel0 = false;
  target.addEventListener('touchstart', e => {
    if (e.touches.length > 1) { sx = null; return; }
    const t = e.touches[0];
    sx = t.clientX; sy = t.clientY; st = Date.now();
    sel0 = hasSelection();
  }, { passive: true });
  target.addEventListener('touchmove', e => { if (e.touches.length > 1) sx = null; }, { passive: true });
  target.addEventListener('touchend', e => {
    lastTouch = Date.now();
    if (sx == null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - sx, dy = t.clientY - sy, dt = Date.now() - st;
    const x0 = sx, y0 = sy;
    sx = null;
    if (sel0 || hasSelection()) return;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.6 && dt < 900) { swipe(dx < 0 ? 'left' : 'right'); return; }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 450) onTap(x0, y0);
  });
  target.addEventListener('click', e => {
    if (Date.now() - lastTouch < 800) return;
    if (hasSelection()) return;
    if (e.target.closest && e.target.closest('a[href]')) return;
    onTap(e.clientX, e.clientY);
  });
}

function keyHandler(shell) {
  return e => {
    if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
    if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); shell.key('next'); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); shell.key('prev'); }
    else if (e.key === 'Escape') shell.key('escape');
  };
}

export const FONTS = [
  { id: 'publisher', label: 'Publisher', css: '' },
  { id: 'iowan', label: 'Iowan', css: '"Iowan Old Style", "Palatino Linotype", Palatino, serif' },
  { id: 'georgia', label: 'Georgia', css: 'Georgia, serif' },
  { id: 'palatino', label: 'Palatino', css: 'Palatino, "Palatino Linotype", "Book Antiqua", serif' },
  { id: 'charter', label: 'Charter', css: 'Charter, "Bitstream Charter", Georgia, serif' },
  { id: 'baskerville', label: 'Baskerville', css: 'Baskerville, "Libre Baskerville", Georgia, serif' },
  { id: 'avenir', label: 'Avenir', css: '"Avenir Next", Avenir, "Helvetica Neue", sans-serif' },
  { id: 'system', label: 'San Francisco', css: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif' }
];
export const SIZES = [13, 15, 17, 19, 21, 24, 27, 31, 35, 40];
export const LINE_HEIGHTS = { tight: 1.3, normal: 1.55, loose: 1.85 };
export const MARGINS = { narrow: 18, medium: 44, wide: 90 };
export const THEMES = {
  white: { bg: '#ffffff', fg: '#1b1b1b', link: '#1f5fa8' },
  sepia: { bg: '#f5ecd9', fg: '#4b3a26', link: '#7a4b12' },
  green: { bg: '#d8e8d2', fg: '#1d2b1d', link: '#28563a' },
  black: { bg: '#000000', fg: '#cfcfcf', link: '#8fb4e8', dark: true }
};
export const HL_COLORS = { yellow: '#f5d547', blue: '#7fb6f0', pink: '#f29ac0', orange: '#f6ad55' };

// ======================================================================
// Reflowable books (EPUB, and TXT which is stored as a generated EPUB)
// ======================================================================
export async function createEpubReader(shell, rec, blob, settings) {
  const buf = await blob.arrayBuffer();
  const book = window.ePub(buf);
  await book.ready;
  const stage = shell.stage;
  stage.innerHTML = '<div class="epub-host"></div>';
  const view = stage.firstChild;
  placeView(settings);

  const rendition = book.renderTo(view, {
    width: '100%', height: '100%',
    flow: 'paginated',
    spread: settings.columns === 'single' ? 'none' : 'auto',
    minSpreadWidth: 900,
    allowScriptedContent: false
  });

  let current = null;
  let s = settings;
  let notes = [];
  const drawn = new Map(); // cfi -> note id
  const CFI = window.ePub.CFI;
  const cfiCmp = (a, b) => { try { return new CFI().compare(a, b); } catch { return 0; } };

  // Table of contents mapped to spine positions, for chapter names.
  const flatToc = [];
  (function walk(items, depth) {
    for (const it of items || []) {
      flatToc.push({ label: (it.label || '').trim(), target: it.href, depth, spine: spineIndex(it.href) });
      walk(it.subitems, depth + 1);
    }
  })(book.navigation?.toc, 0);

  function spineIndex(href) {
    if (!href) return -1;
    const path = href.split('#')[0];
    let sec = book.spine.get(path);
    if (!sec) sec = book.spine.spineItems.find(x => x.href && (x.href.endsWith(path) || path.endsWith(x.href)));
    return sec ? sec.index : -1;
  }
  function chapterFor(index) {
    let best = null;
    for (const t of flatToc) if (t.spine >= 0 && t.spine <= index && (!best || t.spine >= best.spine)) best = t;
    return best ? best.label : '';
  }

  // Locations (about 1,000 characters each) power progress, location numbers and time left.
  let sectionStart = new Map(); // cfiBase -> first location index
  function buildLocMap() {
    sectionStart = new Map();
    const list = book.locations._locations || [];
    list.forEach((c, i) => {
      const base = c.slice(8, c.indexOf('!'));
      if (!sectionStart.has(base)) sectionStart.set(base, i);
    });
  }
  function locReady() { return book.locations.length() > 0; }
  function chapterEnd(index) {
    const items = book.spine.spineItems;
    for (let i = index + 1; i < items.length; i++) {
      const v = sectionStart.get(items[i].cfiBase);
      if (v != null) return v;
    }
    return book.locations.length();
  }

  function makeLoc(l) {
    const cfi = l.start.cfi;
    const ready = locReady();
    const units = ready ? book.locations.length() : 0;
    const idx = ready ? Math.max(0, book.locations.locationFromCfi(cfi)) : 0;
    let progress = ready ? book.locations.percentageFromCfi(cfi) : null;
    if (progress == null || isNaN(progress)) progress = rec.progress || 0;
    if (l.atEnd) progress = 1;
    const disp = l.start.displayed;
    return {
      key: cfi,
      endKey: l.end.cfi,
      progress,
      unit: ready ? idx : null,
      units,
      unitsLeft: ready ? Math.max(0, units - idx - 1) : null,
      chapterLeft: ready ? Math.max(0, chapterEnd(l.start.index) - idx - 1) : null,
      label: ready ? `Location ${idx + 1} of ${units}` : (disp ? `Page ${disp.page} of ${disp.total} in this chapter` : ''),
      chapter: chapterFor(l.start.index),
      atEnd: !!l.atEnd,
      atStart: !!l.atStart
    };
  }

  // ---------- Styles injected into every chapter ----------
  function css() {
    const th = THEMES[s.theme] || THEMES.white;
    const font = FONTS.find(f => f.id === s.font) || FONTS[1];
    const size = SIZES[s.size] || 19;
    const lh = LINE_HEIGHTS[s.lh] || 1.55;
    let out = `
      html, body { background: ${th.bg} !important; color: ${th.fg} !important; }
      body { font-size: ${size}px !important; -webkit-text-size-adjust: none; text-rendering: optimizeLegibility;
             -webkit-tap-highlight-color: transparent; overflow-wrap: break-word; }
      p, li, blockquote, dd { font-size: 1em !important; line-height: ${lh} !important; }
      body, div, span { line-height: ${lh}; }
      img, svg, video { max-width: 100% !important; }
      a { color: ${th.link} !important; }
      ::selection { background: rgba(80, 140, 230, 0.35); }`;
    if (font.css) out += `
      body { font-family: ${font.css} !important; }
      body *:not(code):not(pre):not(kbd):not(samp):not(tt):not(math):not(math *) { font-family: inherit !important; }`;
    if (s.theme !== 'white') out += `
      body *:not(a) { color: inherit !important; }
      body * { background-color: transparent !important; border-color: currentColor !important; }`;
    if (th.dark) out += ` img { filter: brightness(0.85); }`;
    if (s.align === 'justify') out += ` p { text-align: justify !important; -webkit-hyphens: auto; hyphens: auto; }`;
    else if (s.align === 'left') out += ` p { text-align: left !important; -webkit-hyphens: manual; hyphens: manual; }`;
    return out;
  }

  rendition.hooks.content.register(contents => {
    const doc = contents.document;
    const st = doc.createElement('style');
    st.id = 'mr-style';
    st.textContent = css();
    (doc.head || doc.documentElement).appendChild(st);
    const win = contents.window;
    const hasSel = () => { try { return !win.getSelection().isCollapsed; } catch { return false; } };
    gestures(doc, {
      hasSelection: hasSel,
      swipe: dir => shell.swipe(dir),
      onTap: (x, y) => {
        const hit = hitHighlight(doc, x, y);
        if (hit) { shell.onHighlightTap(hit); return; }
        const fr = win.frameElement.getBoundingClientRect();
        const sr = stage.getBoundingClientRect();
        shell.tap((fr.left + x - sr.left) / sr.width);
      }
    });
    doc.addEventListener('selectionchange', () => { if (!hasSel()) shell.onSelectClear(); });
    doc.addEventListener('keydown', keyHandler(shell));
  });

  function hitHighlight(doc, x, y) {
    for (const n of notes) {
      if (n.type !== 'highlight') continue;
      try {
        const r = rendition.getRange(n.pos);
        if (!r || r.startContainer.ownerDocument !== doc) continue;
        for (const rc of r.getClientRects()) {
          if (x >= rc.left - 2 && x <= rc.right + 2 && y >= rc.top - 2 && y <= rc.bottom + 2) return n.id;
        }
      } catch { /* ignore */ }
    }
    return null;
  }

  rendition.on('selected', (cfiRange, contents) => {
    const text = contents.window.getSelection().toString().replace(/\s+/g, ' ').trim();
    if (text) shell.onSelect({ pos: cfiRange, text });
  });

  rendition.on('relocated', l => {
    current = l;
    shell.onLocation(makeLoc(l));
  });

  rendition.on('displayError', e => console.error(e));

  function placeView(st) {
    const m = MARGINS[st.margin] ?? 44;
    view.style.left = m + 'px';
    view.style.right = m + 'px';
  }

  function drawHighlights() {
    for (const [cfi] of drawn) { try { rendition.annotations.remove(cfi, 'highlight'); } catch { /* ignore */ } }
    drawn.clear();
    const dark = (THEMES[s.theme] || {}).dark;
    for (const n of notes) {
      if (n.type !== 'highlight') continue;
      try {
        rendition.annotations.highlight(n.pos, { id: n.id }, () => {}, 'mr-hl', {
          fill: HL_COLORS[n.color] || HL_COLORS.yellow,
          'fill-opacity': dark ? '0.45' : '0.38',
          'mix-blend-mode': dark ? 'normal' : 'multiply'
        });
        drawn.set(n.pos, n.id);
      } catch { /* ignore */ }
    }
  }

  // ---------- Start ----------
  if (rec.locs) {
    try { book.locations.load(rec.locs); buildLocMap(); } catch { rec.locs = null; }
  }
  await rendition.display(rec.pos || undefined).catch(() => rendition.display());
  if (!rec.locs) {
    setTimeout(async () => {
      try {
        await book.locations.generate(1024);
        rec.locs = book.locations.save();
        buildLocMap();
        shell.saveRec();
        if (current) shell.onLocation(makeLoc(current));
      } catch (e) { console.error(e); }
    }, 400);
  }

  return {
    kind: 'epub',
    supports: { highlight: true, tts: true, search: true, toc: true, columns: true, typography: true },
    rtl: book.package?.metadata?.direction === 'rtl',
    next: () => rendition.next(),
    prev: () => rendition.prev(),
    goto: target => rendition.display(target),
    async gotoPercent(p) {
      if (locReady()) return rendition.display(book.locations.cfiFromPercentage(Math.min(0.9999, Math.max(0, p))));
      const items = book.spine.spineItems;
      return rendition.display(items[Math.min(items.length - 1, Math.floor(p * items.length))].href);
    },
    toc: async () => flatToc.map(t => ({ label: t.label, target: t.target, depth: t.depth })),
    currentChapterTarget() {
      if (!current) return null;
      let best = null;
      for (const t of flatToc) if (t.spine >= 0 && t.spine <= current.start.index && (!best || t.spine >= best.spine)) best = t;
      return best ? best.target : null;
    },
    async search(q, onProgress) {
      const results = [];
      const items = book.spine.spineItems;
      for (let i = 0; i < items.length && results.length < 300; i++) {
        const item = items[i];
        onProgress?.(Math.round(i / items.length * 100));
        try {
          await item.load(book.load.bind(book));
          for (const r of item.find(q)) results.push({ target: r.cfi, excerpt: r.excerpt, label: chapterFor(item.index) });
        } catch { /* skip */ } finally { try { item.unload(); } catch { /* ignore */ } }
      }
      return results;
    },
    flash(cfi) {
      try {
        rendition.annotations.highlight(cfi, {}, () => {}, 'mr-flash', { fill: '#ffb000', 'fill-opacity': '0.45' });
        setTimeout(() => { try { rendition.annotations.remove(cfi, 'highlight'); drawHighlights(); } catch { /* ignore */ } }, 2500);
      } catch { /* ignore */ }
    },
    async pageText() {
      if (!current) return '';
      try {
        const r1 = rendition.getRange(current.start.cfi);
        const r2 = rendition.getRange(current.end.cfi);
        const doc = r1.startContainer.ownerDocument;
        const range = doc.createRange();
        range.setStart(r1.startContainer, r1.startOffset);
        if (r2 && r2.endContainer.ownerDocument === doc) range.setEnd(r2.endContainer, r2.endOffset);
        else range.setEndAfter(doc.body.lastChild || doc.body);
        // Keep headings and paragraphs apart so the voice pauses between them.
        const frag = range.cloneContents();
        frag.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,div,blockquote,br,tr,dt,dd').forEach(el => el.appendChild(doc.createTextNode('. \n')));
        return (frag.textContent || '').replace(/([.!?…])\s*\.\s*\n/g, '$1\n').replace(/\.\s*\n(\s*\.\s*\n)+/g, '.\n');
      } catch (e) {
        console.error(e);
        return '';
      }
    },
    setNotes(list) { notes = list; drawHighlights(); },
    compare: cfiCmp,
    onPage(pos) {
      if (!current || !pos) return false;
      return cfiCmp(pos, current.start.cfi) >= 0 && cfiCmp(pos, current.end.cfi) <= 0;
    },
    clearSelection() {
      for (const c of rendition.getContents()) { try { c.window.getSelection().removeAllRanges(); } catch { /* ignore */ } }
    },
    applySettings(next) {
      const spreadChanged = next.columns !== s.columns;
      const marginChanged = next.margin !== s.margin;
      s = { ...next };
      for (const c of rendition.getContents()) {
        const st = c.document.getElementById('mr-style');
        if (st) st.textContent = css();
      }
      if (spreadChanged) rendition.spread(s.columns === 'single' ? 'none' : 'auto', 900);
      if (marginChanged) { placeView(s); rendition.resize(); }
      drawHighlights();
      const keep = current?.start.cfi;
      setTimeout(() => { if (keep) rendition.display(keep); }, 120);
    },
    resize() { /* epub.js follows window size itself */ },
    destroy() {
      try { rendition.destroy(); } catch { /* ignore */ }
      try { book.destroy(); } catch { /* ignore */ }
    }
  };
}

// ======================================================================
// PDF
// ======================================================================
export async function createPdfReader(shell, rec, blob, settings) {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const total = doc.numPages;
  let s = settings;
  let page = Math.min(total, Math.max(1, Number(rec.pos) || 1));
  const stage = shell.stage;
  stage.innerHTML = `<div class="pdf-scroller"><div class="pdf-page"><canvas></canvas><div class="textLayer"></div></div></div>`;
  const scroller = stage.querySelector('.pdf-scroller');
  const pageEl = stage.querySelector('.pdf-page');
  const canvas = stage.querySelector('canvas');
  const textDiv = stage.querySelector('.textLayer');
  let task = null, token = 0;
  const textCache = new Map();

  // Outline gives chapter names and "time left in chapter".
  let outline = [];
  (async () => {
    try {
      const out = await doc.getOutline();
      const flat = [];
      const walk = async (items, depth) => {
        for (const it of items || []) {
          let p = null;
          try {
            let dest = it.dest;
            if (typeof dest === 'string') dest = await doc.getDestination(dest);
            if (Array.isArray(dest)) {
              const ref = dest[0];
              p = typeof ref === 'number' ? ref + 1 : (await doc.getPageIndex(ref)) + 1;
            }
          } catch { /* ignore */ }
          flat.push({ label: (it.title || '').trim(), target: p, depth });
          await walk(it.items, depth + 1);
        }
      };
      await walk(out, 0);
      outline = flat;
      shell.onLocation(loc());
    } catch { /* no outline */ }
  })();

  function chapterInfo() {
    const withPages = outline.filter(o => o.target);
    let cur = null, nextP = null;
    for (const o of withPages) { if (o.target <= page && (!cur || o.target >= cur.target)) cur = o; }
    for (const o of withPages) { if (o.target > page && (nextP == null || o.target < nextP)) nextP = o.target; }
    return { title: cur?.label || '', left: cur ? (nextP ? nextP - page - 1 : total - page) : null };
  }

  function loc() {
    const ch = chapterInfo();
    return {
      key: page,
      progress: total > 1 ? (page - 1) / (total - 1) : 1,
      unit: page, units: total, unitsLeft: total - page,
      chapterLeft: ch.left,
      chapter: ch.title,
      label: `Page ${page} of ${total}`,
      atEnd: page >= total, atStart: page <= 1
    };
  }

  async function render() {
    const my = ++token;
    if (task) { try { task.cancel(); } catch { /* ignore */ } }
    const p = await doc.getPage(page);
    if (my !== token) return;
    const base = p.getViewport({ scale: 1 });
    const pad = 16;
    const W = Math.max(100, scroller.clientWidth - pad * 2);
    const H = Math.max(100, scroller.clientHeight - pad * 2);
    const scale = s.pdfFit === 'width' ? W / base.width : Math.min(W / base.width, H / base.height);
    const vp = p.getViewport({ scale });
    const maxPixels = 5e6;
    const dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(maxPixels / (vp.width * vp.height)));
    const off = document.createElement('canvas');
    off.width = Math.floor(vp.width * dpr);
    off.height = Math.floor(vp.height * dpr);
    const ctx = off.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, off.width, off.height);
    task = p.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
    try { await task.promise; } catch (e) { if (my === token) console.error(e); return; }
    if (my !== token) return;
    canvas.width = off.width;
    canvas.height = off.height;
    canvas.getContext('2d').drawImage(off, 0, 0);
    canvas.style.width = Math.floor(vp.width) + 'px';
    canvas.style.height = Math.floor(vp.height) + 'px';
    pageEl.style.width = Math.floor(vp.width) + 'px';
    pageEl.style.height = Math.floor(vp.height) + 'px';
    pageEl.style.setProperty('--scale-factor', scale);
    scroller.classList.toggle('fit-width', s.pdfFit === 'width');
    textDiv.innerHTML = '';
    try {
      const tl = new pdfjs.TextLayer({ textContentSource: p.streamTextContent(), container: textDiv, viewport: vp });
      await tl.render();
    } catch { /* text layer is optional */ }
    if (page < total) doc.getPage(page + 1).catch(() => {});
  }

  async function show(n, toTop = true) {
    page = Math.min(total, Math.max(1, n));
    if (toTop) scroller.scrollTop = 0;
    shell.onLocation(loc());
    await render();
  }

  const hasSel = () => { const sel = window.getSelection(); return sel && !sel.isCollapsed && textDiv.contains(sel.anchorNode); };
  gestures(scroller, {
    hasSelection: hasSel,
    swipe: dir => shell.swipe(dir),
    onTap: x => {
      const r = stage.getBoundingClientRect();
      shell.tap((x - r.left) / r.width);
    }
  });
  const onSel = () => {
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed && textDiv.contains(sel.anchorNode)) {
      const text = sel.toString().replace(/\s+/g, ' ').trim();
      if (text) shell.onSelect({ pos: page, text });
    } else shell.onSelectClear();
  };
  document.addEventListener('selectionchange', onSel);
  const applyDark = () => stage.classList.toggle('pdf-dark', !!(THEMES[s.theme] || {}).dark && s.pdfDark !== false);
  applyDark();

  async function pageTextOf(n) {
    if (textCache.has(n)) return textCache.get(n);
    const p = await doc.getPage(n);
    const tc = await p.getTextContent();
    const t = tc.items.map(i => (i.str || '') + (i.hasEOL ? '\n' : ' ')).join('').replace(/[ \t]+/g, ' ');
    textCache.set(n, t);
    if (textCache.size > 60) textCache.delete(textCache.keys().next().value);
    return t;
  }

  await show(page);

  return {
    kind: 'pdf',
    supports: { highlight: false, tts: true, search: true, toc: true, pdf: true },
    rtl: false,
    next: () => (page < total ? show(page + 1) : shell.onLocation({ ...loc(), atEnd: true })),
    prev: () => (page > 1 ? show(page - 1) : null),
    goto: target => show(Number(target) || 1),
    gotoPercent: p => show(Math.round(1 + p * (total - 1))),
    toc: async () => outline.filter(o => o.target),
    currentChapterTarget() {
      let cur = null;
      for (const o of outline) if (o.target && o.target <= page && (!cur || o.target >= cur.target)) cur = o;
      return cur?.target ?? null;
    },
    async search(q, onProgress) {
      const ql = q.toLowerCase();
      const results = [];
      for (let n = 1; n <= total && results.length < 300; n++) {
        if (n % 10 === 0) onProgress?.(Math.round(n / total * 100));
        let t;
        try { t = await pageTextOf(n); } catch { continue; }
        const lower = t.toLowerCase();
        let i = lower.indexOf(ql);
        let count = 0;
        while (i >= 0 && count < 5) {
          const a = Math.max(0, i - 50), b = Math.min(t.length, i + q.length + 70);
          results.push({ target: n, excerpt: (a > 0 ? '…' : '') + t.slice(a, b).trim() + (b < t.length ? '…' : ''), label: `Page ${n}` });
          i = lower.indexOf(ql, i + ql.length);
          count++;
        }
      }
      return results;
    },
    flash() {},
    pageText: () => pageTextOf(page),
    setNotes() {},
    compare: (a, b) => Number(a) - Number(b),
    onPage: pos => Number(pos) === page,
    clearSelection() { try { window.getSelection().removeAllRanges(); } catch { /* ignore */ } },
    applySettings(next) {
      const rerender = next.pdfFit !== s.pdfFit;
      s = { ...next };
      applyDark();
      if (rerender) render();
    },
    resize() { render(); },
    destroy() {
      document.removeEventListener('selectionchange', onSel);
      token++;
      try { task?.cancel(); } catch { /* ignore */ }
      doc.destroy();
    }
  };
}

// ======================================================================
// Comics and manga (CBZ)
// ======================================================================
export async function createComicReader(shell, rec, blob, settings) {
  const zip = await window.JSZip.loadAsync(await blob.arrayBuffer());
  const names = comicPages(zip);
  const total = names.length;
  if (!total) throw new Error('This archive has no pages');
  let s = settings;
  let page = Math.min(total, Math.max(1, Number(rec.pos) || 1)); // 1-based
  const stage = shell.stage;
  stage.innerHTML = '<div class="comic-scroller"><div class="comic-pages"></div></div>';
  const scroller = stage.querySelector('.comic-scroller');
  const holder = stage.querySelector('.comic-pages');
  const urls = new Map();

  async function urlFor(i) {
    if (urls.has(i)) return urls.get(i);
    const b = await zip.file(names[i - 1]).async('blob');
    const u = URL.createObjectURL(b);
    urls.set(i, u);
    // Keep only nearby pages in memory.
    for (const k of [...urls.keys()]) if (Math.abs(k - i) > 4) { URL.revokeObjectURL(urls.get(k)); urls.delete(k); }
    return u;
  }

  const spread = () => s.comicSpread !== false && stage.clientWidth > stage.clientHeight && s.comicFit !== 'width';
  const rtl = () => s.comicDir === 'rtl';
  // In two-page mode the cover stands alone, then pages pair up: (2,3), (4,5) …
  const norm = n => (spread() ? (n <= 1 ? 1 : (n % 2 === 0 ? n : n - 1)) : n);
  const shown = () => {
    const n = norm(page);
    return spread() && n > 1 && n + 1 <= total ? [n, n + 1] : [n];
  };

  function loc() {
    const v = shown();
    const last = v[v.length - 1];
    return {
      key: v[0],
      progress: total > 1 ? (last - 1) / (total - 1) : 1,
      unit: v[0], units: total, unitsLeft: total - last,
      chapterLeft: null, chapter: '',
      label: v.length > 1 ? `Pages ${v[0]}–${v[1]} of ${total}` : `Page ${v[0]} of ${total}`,
      atEnd: last >= total, atStart: v[0] <= 1
    };
  }

  let token = 0;
  async function render() {
    const my = ++token;
    page = norm(page);
    const v = shown();
    const order = rtl() ? [...v].reverse() : v;
    const srcs = await Promise.all(order.map(urlFor));
    if (my !== token) return;
    holder.className = `comic-pages ${v.length > 1 ? 'two' : 'one'} ${s.comicFit === 'width' ? 'fit-width' : ''}`;
    holder.innerHTML = srcs.map(u => `<img src="${esc(u)}" alt="" draggable="false">`).join('');
    scroller.scrollTop = 0;
    const ahead = v[v.length - 1] + 1;
    if (ahead <= total) urlFor(ahead).catch(() => {});
    if (spread() && ahead + 1 <= total) urlFor(ahead + 1).catch(() => {});
  }

  async function show(n) {
    page = Math.min(total, Math.max(1, n));
    page = norm(page);
    shell.onLocation(loc());
    await render();
  }

  gestures(scroller, {
    hasSelection: () => false,
    swipe: dir => shell.swipe(dir),
    onTap: x => {
      const r = stage.getBoundingClientRect();
      shell.tap((x - r.left) / r.width);
    }
  });

  await show(page);

  const step = () => shown().length;
  return {
    kind: 'cbz',
    supports: { highlight: false, tts: false, search: false, toc: false, comic: true },
    get rtl() { return rtl(); },
    next: () => {
      const v = shown();
      const last = v[v.length - 1];
      if (last >= total) { shell.onLocation({ ...loc(), atEnd: true }); return; }
      return show(spread() && v[0] === 1 ? 2 : page + step());
    },
    prev: () => {
      if (page <= 1) return;
      return show(spread() ? (page <= 3 ? 1 : page - 2) : page - 1);
    },
    goto: target => show(Number(target) || 1),
    gotoPercent: p => show(Math.round(1 + p * (total - 1))),
    toc: async () => [],
    currentChapterTarget: () => null,
    search: async () => [],
    flash() {},
    pageText: async () => '',
    setNotes() {},
    compare: (a, b) => Number(a) - Number(b),
    onPage: pos => shown().includes(Number(pos)),
    clearSelection() {},
    applySettings(next) { s = { ...next }; show(page); },
    resize() { show(page); },
    destroy() {
      token++;
      for (const u of urls.values()) URL.revokeObjectURL(u);
      urls.clear();
    }
  };
}
