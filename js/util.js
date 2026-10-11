// Small helpers shared by every screen.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Settings live in localStorage; every access is guarded because storage can be unavailable.
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('mr.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('mr.' + key, JSON.stringify(value)); } catch { /* ignore */ }
  }
};

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

export function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export function formatBytes(n) {
  if (!n) return '0 KB';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i < 2 ? Math.round(n) : n.toFixed(1)) + ' ' + u[i];
}

export function formatDuration(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return 'Less than a minute';
  if (m < 60) return `${m} min${m === 1 ? '' : 's'}`;
  const h = Math.floor(m / 60), r = m % 60;
  return `${h} hr${h === 1 ? '' : 's'}${r ? ` ${r} min${r === 1 ? '' : 's'}` : ''}`;
}

export function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------- Icons (simple line drawings) ----------
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1"/>',
  list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  sort: '<path d="M7 4v16M3.5 16.5L7 20l3.5-3.5M17 20V4M13.5 7.5L17 4l3.5 3.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.5 5.5l1.7 1.7M16.8 16.8l1.7 1.7M5.5 18.5l1.7-1.7M16.8 7.2l1.7-1.7"/>',
  more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor"/>',
  toc: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor"/><circle cx="4.5" cy="12" r="1" fill="currentColor"/><circle cx="4.5" cy="18" r="1" fill="currentColor"/>',
  aa: '<path d="M3 19l5-13 5 13M4.8 14.5h6.4"/><path d="M15 12.5c.6-1.3 1.8-2 3.2-2 2 0 2.8 1.2 2.8 3V19M21 15.3c-3.3 0-5.6.6-5.6 2.1 0 1 .9 1.6 2.1 1.6 2 0 3.5-1.4 3.5-3.7"/>',
  bookmark: '<path d="M7 3.5h10v17l-5-3.8-5 3.8z"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>',
  pause: '<path d="M8 5.5v13M16 5.5v13" stroke-width="3"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  note: '<path d="M5 4h14v11l-5 5H5z"/><path d="M14 20v-5h5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="1.5"/><path d="M16 8V5.5A1.5 1.5 0 0014.5 4h-9A1.5 1.5 0 004 5.5v9A1.5 1.5 0 005.5 16H8"/>',
  book: '<path d="M4 5.5C6.5 4.3 9.3 4.3 12 6c2.7-1.7 5.5-1.7 8-.5v13c-2.5-1.2-5.3-1.2-8 .5-2.7-1.7-5.5-1.7-8-.5z"/><path d="M12 6v13.5"/>',
  trash: '<path d="M4.5 7h15M10 7V4.5h4V7M6.5 7l1 13h9l1-13"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  share: '<path d="M12 15V3.5M7.5 8L12 3.5 16.5 8"/><path d="M5 12v7.5h14V12"/>',
  define: '<path d="M5 4.5h10.5a3 3 0 013 3v12H8a3 3 0 01-3-3z"/><path d="M5 16.5a3 3 0 013-3h10.5"/>',
  highlight: '<path d="M14.5 4.5l5 5L11 18H6v-5z"/><path d="M4 21h16"/>',
  folder: '<path d="M3.5 6.5h6l2 2h9v10.5h-17z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
  prev: '<path d="M18 6l-6 6 6 6M11 6l-6 6 6 6"/>',
  next: '<path d="M6 6l6 6-6 6M13 6l6 6-6 6"/>'
};

export function icon(name, cls = '') {
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// ---------- Toast ----------
let toastTimer;
export function toast(msg, opts = {}) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(msg)}</span>${opts.action ? `<button>${esc(opts.action)}</button>` : ''}`;
  if (opts.action) $('button', el).onclick = () => { el.classList.remove('show'); opts.onAction?.(); };
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), opts.duration || (opts.action ? 6000 : 2600));
}

// ---------- Sheets and dialogs ----------
// A sheet slides up from the bottom (or appears centred on wide screens).
export function openSheet({ title = '', body = '', className = '', onClose, side = false } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap ${side ? 'side' : ''} ${className}`;
  wrap.innerHTML = `
    <div class="sheet-scrim"></div>
    <div class="sheet" role="dialog" aria-label="${esc(title)}">
      ${title ? `<div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn sheet-x" aria-label="Close">${icon('close')}</button></div>` : ''}
      <div class="sheet-body"></div>
    </div>`;
  const bodyEl = $('.sheet-body', wrap);
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    onClose?.();
  };
  $('.sheet-scrim', wrap).onclick = close;
  const x = $('.sheet-x', wrap);
  if (x) x.onclick = close;
  return { el: wrap, body: bodyEl, close };
}

export function confirmDialog(message, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    const s = openSheet({
      className: 'dialog',
      body: `<p class="dlg-msg">${esc(message)}</p>
        <div class="dlg-actions"><button class="btn ghost" data-v="0">Cancel</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(okLabel)}</button></div>`,
      onClose: () => resolve(false)
    });
    s.body.addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      const v = b.dataset.v === '1';
      resolve(v);
      s.close();
    });
  });
}

export function promptDialog(title, value = '', { multiline = false, placeholder = '', okLabel = 'Save', quote = '' } = {}) {
  return new Promise(resolve => {
    let done = false;
    const s = openSheet({
      className: 'dialog',
      title,
      body: `${quote ? `<blockquote class="dlg-quote">${esc(quote)}</blockquote>` : ''}
        ${multiline
          ? `<textarea class="field" rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
          : `<input class="field" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}">`}
        <div class="dlg-actions"><button class="btn ghost" data-v="0">Cancel</button><button class="btn primary" data-v="1">${esc(okLabel)}</button></div>`,
      onClose: () => { if (!done) resolve(null); }
    });
    const f = $('.field', s.body);
    setTimeout(() => f.focus(), 250);
    s.body.addEventListener('click', e => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      done = true;
      resolve(b.dataset.v === '1' ? f.value : null);
      s.close();
    });
    if (!multiline) f.addEventListener('keydown', e => { if (e.key === 'Enter') { done = true; resolve(f.value); s.close(); } });
  });
}

// ---------- Images ----------
export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function canvasToBlob(canvas, type = 'image/jpeg', q = 0.85) {
  return new Promise(r => canvas.toBlob(r, type, q));
}

// Shrinks an image (blob or URL) so stored covers stay small.
export async function downscaleImage(src, maxW = 360) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxW / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return await canvasToBlob(c);
  } finally {
    if (src instanceof Blob) URL.revokeObjectURL(url);
  }
}

// A plain typographic cover for books that have none.
const COVER_COLOURS = ['#1f3a5f', '#6b2737', '#2f4f3a', '#3f4652', '#7a5a1e', '#4b3a5e', '#24525a', '#5c3d2e'];
export async function generateCover(title, author, label = '') {
  const W = 360, H = 540;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  let hash = 0;
  for (const ch of title || '') hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const bg = COVER_COLOURS[Math.abs(hash) % COVER_COLOURS.length];
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 2;
  ctx.strokeRect(18, 18, W - 36, H - 36);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.strokeRect(26, 26, W - 52, H - 52);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  const serif = '"Iowan Old Style", "Palatino", Georgia, serif';
  const lines = wrapText(ctx, title || 'Untitled', W - 90, `600 34px ${serif}`, 5);
  ctx.font = `600 34px ${serif}`;
  let y = 170 - (lines.length - 1) * 20;
  for (const l of lines) { ctx.fillText(l, W / 2, y); y += 42; }
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillRect(W / 2 - 24, y + 4, 48, 2);
  if (author) {
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const al = wrapText(ctx, author, W - 90, `italic 20px ${serif}`, 2);
    ctx.font = `italic 20px ${serif}`;
    y += 44;
    for (const l of al) { ctx.fillText(l, W / 2, y); y += 26; }
  }
  if (label) {
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '600 13px -apple-system, "Helvetica Neue", sans-serif';
    ctx.fillText(label.toUpperCase().split('').join(' '), W / 2, H - 50);
  }
  return canvasToBlob(c);
}

function wrapText(ctx, text, maxW, font, maxLines) {
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const cut = lines.slice(0, maxLines);
    cut[maxLines - 1] = cut[maxLines - 1].replace(/\s*\S*$/, '') + '…';
    return cut;
  }
  return lines;
}

// Keeps one object URL per cover blob so the library doesn't leak memory.
const coverUrls = new Map();
export function coverUrl(book) {
  if (!book.cover) return '';
  const hit = coverUrls.get(book.id);
  if (hit && hit.blob === book.cover) return hit.url;
  if (hit) URL.revokeObjectURL(hit.url);
  const url = URL.createObjectURL(book.cover);
  coverUrls.set(book.id, { blob: book.cover, url });
  return url;
}
export function dropCoverUrl(id) {
  const hit = coverUrls.get(id);
  if (hit) { URL.revokeObjectURL(hit.url); coverUrls.delete(id); }
}

// Downloads or shares a text file.
export async function shareText(filename, text) {
  const file = new File([text], filename, { type: 'text/plain' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
