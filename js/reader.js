// The reading screen: page chrome, the Aa panel, contents/notebook/bookmarks,
// search, highlights and notes, dictionary, read aloud and time left.
import { DB } from './db.js';
import { $, $$, esc, icon, store, toast, openSheet, confirmDialog, promptDialog, debounce, formatDuration, uid, shareText, formatDate } from './util.js';
import { createEpubReader, createPdfReader, createComicReader, FONTS, SIZES, THEMES, HL_COLORS } from './formats.js';

const DEFAULTS = {
  font: 'iowan', size: 3, lh: 'normal', margin: 'medium', theme: 'white', align: 'justify',
  columns: 'auto', dim: 0, footer: 'chapter', rate: 1, voice: '',
  pdfFit: 'page', pdfDark: true, comicDir: 'ltr', comicSpread: true, comicFit: 'page'
};
// Seconds per unit before the app has learned your speed:
// text = per location (about 1,000 characters), pdf/comic = per page.
const DEFAULT_SPEED = { text: 45, pdf: 75, cbz: 15 };
const FOOTER_MODES = ['chapter', 'book', 'location', 'none'];

export const Reader = {
  rec: null,
  engine: null,
  loc: null,
  notes: [],
  settings: { ...DEFAULTS, ...store.get('reader', {}) },
  el: null,
  stage: null,
  chrome: false,
  onClose: null,
  selection: null,

  speedKey() { return this.rec.format === 'pdf' ? 'pdf' : this.rec.format === 'cbz' ? 'cbz' : 'text'; },

  async open(rec, container) {
    this.rec = rec;
    this.loc = null;
    this.chrome = false;
    this.selection = null;
    this.lastMove = null;
    this.endShown = false;
    container.innerHTML = `
      <div class="reader" data-format="${rec.format}">
        <div class="r-head"><span class="r-head-text">${esc(rec.title)}</span></div>
        <div class="r-stage"></div>
        <div class="r-foot"><button class="r-foot-left" aria-label="Change reading progress display"></button><span class="r-foot-right"></span></div>
        <div class="r-ribbon" hidden>${icon('bookmark')}</div>
        <div class="r-dim"></div>
        <div class="r-chrome">
          <div class="r-top">
            <button class="r-back" data-a="back">${icon('back')}<span>Library</span></button>
            <div class="r-title">${esc(rec.title)}</div>
            <div class="r-tools">
              <button class="icon-btn" data-a="panel" aria-label="Contents and notes">${icon('toc')}</button>
              <button class="icon-btn" data-a="search" aria-label="Search this book">${icon('search')}</button>
              <button class="icon-btn" data-a="aa" aria-label="Display settings">${icon('aa')}</button>
              <button class="icon-btn" data-a="tts" aria-label="Read aloud">${icon('speaker')}</button>
              <button class="icon-btn" data-a="bookmark" aria-label="Bookmark this page">${icon('bookmark')}</button>
            </div>
          </div>
          <div class="r-bottom">
            <div class="r-chapter-name"></div>
            <div class="r-slider-row">
              <button class="icon-btn" data-a="chapter-start" aria-label="Start of chapter">${icon('prev')}</button>
              <input class="r-slider" type="range" min="0" max="1000" value="0" aria-label="Go to position">
              <button class="icon-btn" data-a="next-page" aria-label="Next page">${icon('next')}</button>
            </div>
            <div class="r-pos"><span class="r-pos-label"></span><span class="r-pos-pct"></span></div>
          </div>
        </div>
        <div class="selbar" hidden></div>
        <div class="tts-bar" hidden></div>
        <div class="r-loading"><div class="spinner"></div><span>Opening…</span></div>
      </div>`;
    this.el = $('.reader', container);
    this.stage = $('.r-stage', this.el);
    this.applyTheme();
    this.bind();

    try {
      const file = await DB.get('files', rec.id);
      if (!file) throw new Error('The book file is missing');
      const make = rec.format === 'pdf' ? createPdfReader : rec.format === 'cbz' ? createComicReader : createEpubReader;
      this.engine = await make(this, rec, file.blob, this.settings);
    } catch (e) {
      console.error(e);
      $('.r-loading', this.el).innerHTML = `<p>Sorry, this book couldn't be opened.</p><p class="muted small">${esc(e.message || e)}</p><button class="btn primary" data-a="back">Back to Library</button>`;
      return;
    }
    $('.r-loading', this.el).remove();
    const sup = this.engine.supports;
    if (!sup.tts) $('[data-a=tts]', this.el).remove();
    if (!sup.search) $('[data-a=search]', this.el).remove();
    this.notes = await DB.notesFor(rec.id);
    this.engine.setNotes(this.notes);
    this.updateRibbon();
    if (rec.status === 'unread') { rec.status = 'reading'; }
    rec.lastOpened = Date.now();
    this.saveRec();
  },

  bind() {
    const el = this.el;
    el.addEventListener('click', e => {
      const t = e.target.closest('[data-a]');
      if (!t) return;
      this.action(t.dataset.a, t);
    });
    $('.r-foot-left', el).addEventListener('click', e => {
      e.stopPropagation();
      const i = FOOTER_MODES.indexOf(this.settings.footer);
      this.settings.footer = FOOTER_MODES[(i + 1) % FOOTER_MODES.length];
      this.saveSettings();
      this.updateFooter();
    });
    const slider = $('.r-slider', el);
    slider.addEventListener('input', () => {
      $('.r-pos-pct', el).textContent = `${Math.round(slider.value / 10)}%`;
    });
    slider.addEventListener('change', () => this.engine?.gotoPercent(slider.value / 1000));
    this.keyFn = e => {
      if (!this.el || document.querySelector('.sheet-wrap')) return;
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      if (['ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); this.key('next'); }
      else if (['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); this.key('prev'); }
      else if (e.key === 'Escape') this.key('escape');
    };
    document.addEventListener('keydown', this.keyFn);
    this.resizeFn = debounce(() => this.engine?.resize(), 250);
    window.addEventListener('resize', this.resizeFn);
  },

  async close() {
    TTS.stop();
    document.removeEventListener('keydown', this.keyFn);
    window.removeEventListener('resize', this.resizeFn);
    await this.saveRecNow();
    try { this.engine?.destroy(); } catch { /* ignore */ }
    this.engine = null;
    this.el = null;
    setThemeColor('#ffffff');
    this.onClose?.();
  },

  // ---------- Page turning ----------
  next() { this.hideChrome(); this.engine?.next(); },
  prev() { this.hideChrome(); this.engine?.prev(); },
  key(k) {
    if (k === 'escape') { this.chrome ? this.hideChrome() : null; return; }
    if (k === 'next') this.next(); else this.prev();
  },
  tap(f) {
    if (this.selection) { this.engine?.clearSelection(); this.onSelectClear(); return; }
    if (this.chrome) { this.hideChrome(); return; }
    const rtl = this.engine?.rtl;
    if (f < 0.28) rtl ? this.next() : this.prev();
    else if (f > 0.72) rtl ? this.prev() : this.next();
    else this.showChrome();
  },
  swipe(dir) {
    const rtl = this.engine?.rtl;
    if (dir === 'left') rtl ? this.prev() : this.next();
    else rtl ? this.next() : this.prev();
  },
  showChrome() { this.chrome = true; this.el?.classList.add('chrome-on'); },
  hideChrome() { this.chrome = false; this.el?.classList.remove('chrome-on'); },

  // ---------- Location updates ----------
  onLocation(loc) {
    if (!this.el) return;
    const prev = this.loc;
    this.loc = loc;
    this.trackSpeed(prev, loc);
    this.updateFooter();
    this.updateRibbon();
    if (this.rec) {
      this.rec.pos = loc.key;
      this.rec.progress = loc.progress;
      this.rec.lastOpened = Date.now();
      this.saveRec();
    }
    if (loc.atEnd && this.rec.status !== 'finished' && !this.endShown) {
      this.endShown = true;
      toast('You’ve reached the end', {
        action: 'Mark as finished',
        onAction: () => { this.rec.status = 'finished'; this.rec.progress = 1; this.saveRec(); toast('Marked as finished'); }
      });
    }
    TTS.onLocation();
  },

  trackSpeed(prev, loc) {
    const now = Date.now();
    const last = this.lastMove;
    this.lastMove = { t: now, unit: loc.unit };
    if (!last || last.unit == null || loc.unit == null || TTS.active) return;
    const diff = loc.unit - last.unit;
    const dt = (now - last.t) / 1000;
    if (diff < 1 || diff > 4 || dt < 3 || dt > 600) return;
    const sp = store.get('speed', {});
    const key = this.speedKey();
    const cur = sp[key] || DEFAULT_SPEED[key];
    sp[key] = cur * 0.85 + (dt / diff) * 0.15;
    store.set('speed', sp);
  },

  timeLeft(units) {
    const sp = store.get('speed', {})[this.speedKey()] || DEFAULT_SPEED[this.speedKey()];
    return formatDuration(units * sp);
  },

  updateFooter() {
    if (!this.el || !this.loc) return;
    const l = this.loc;
    const mode = this.settings.footer;
    let left = '';
    if (mode === 'chapter' && l.chapterLeft != null) left = `${this.timeLeft(l.chapterLeft + 1)} left in chapter`;
    else if ((mode === 'chapter' || mode === 'book') && l.unitsLeft != null) left = `${this.timeLeft(l.unitsLeft + 1)} left in book`;
    else if (mode === 'location' || mode === 'chapter' || mode === 'book') left = l.label;
    $('.r-foot-left', this.el).textContent = left;
    $('.r-foot-left', this.el).classList.toggle('blank', mode === 'none');
    const pct = `${Math.round(l.progress * 100)}%`;
    $('.r-foot-right', this.el).textContent = pct;
    $('.r-pos-label', this.el).textContent = l.label;
    $('.r-pos-pct', this.el).textContent = pct;
    $('.r-chapter-name', this.el).textContent = l.chapter || '';
    $('.r-head-text', this.el).textContent = l.chapter || this.rec.title;
    const slider = $('.r-slider', this.el);
    if (document.activeElement !== slider) slider.value = Math.round(l.progress * 1000);
  },

  // ---------- Saving ----------
  saveRec: debounce(function () { Reader.saveRecNow(); }, 700),
  async saveRecNow() { if (this.rec) { try { await DB.put('books', this.rec); } catch (e) { console.error(e); } } },
  saveSettings() { store.set('reader', this.settings); },

  // ---------- Theme ----------
  applyTheme() {
    const th = THEMES[this.settings.theme] || THEMES.white;
    const el = this.el;
    el.dataset.theme = this.settings.theme;
    document.documentElement.dataset.ui = th.dark ? 'dark' : 'light';
    el.style.setProperty('--r-bg', th.bg);
    el.style.setProperty('--r-fg', th.fg);
    $('.r-dim', el).style.opacity = (this.settings.dim || 0) / 100;
    setThemeColor(th.bg);
  },

  applySettings() {
    this.saveSettings();
    this.applyTheme();
    this.engine?.applySettings(this.settings);
    this.updateFooter();
  },

  // ---------- Toolbar actions ----------
  action(a) {
    switch (a) {
      case 'back': this.close(); break;
      case 'panel': this.panel(); break;
      case 'search': this.search(); break;
      case 'aa': this.aaPanel(); break;
      case 'tts': TTS.start(); this.hideChrome(); break;
      case 'bookmark': this.toggleBookmark(); break;
      case 'next-page': this.engine?.next(); break;
      case 'chapter-start': {
        const t = this.engine?.currentChapterTarget?.();
        if (t != null) this.engine.goto(t);
        break;
      }
    }
  },

  // ---------- Bookmarks ----------
  currentBookmark() {
    if (!this.engine) return null;
    return this.notes.find(n => n.type === 'bookmark' && this.engine.onPage(n.pos)) || null;
  },
  updateRibbon() {
    if (!this.el) return;
    const bm = this.currentBookmark();
    $('.r-ribbon', this.el).hidden = !bm;
    $('[data-a=bookmark]', this.el)?.classList.toggle('on', !!bm);
  },
  async toggleBookmark() {
    if (!this.loc) return;
    const bm = this.currentBookmark();
    if (bm) {
      await DB.del('notes', bm.id);
      this.notes = this.notes.filter(n => n.id !== bm.id);
      toast('Bookmark removed');
    } else {
      const n = {
        id: uid(), bookId: this.rec.id, type: 'bookmark', pos: this.loc.key,
        label: this.loc.label, chapter: this.loc.chapter, text: '', created: Date.now()
      };
      try { n.text = (await this.engine.pageText()).replace(/\s+/g, ' ').trim().slice(0, 140); } catch { /* ignore */ }
      await DB.put('notes', n);
      this.notes.push(n);
      toast('Page bookmarked');
    }
    this.updateRibbon();
  },

  // ---------- Selection, highlights and notes ----------
  onSelect(sel) {
    this.selection = sel;
    const bar = $('.selbar', this.el);
    const sup = this.engine?.supports || {};
    bar.innerHTML = `
      ${sup.highlight ? Object.entries(HL_COLORS).map(([k, c]) => `<button class="swatch" data-hl="${k}" style="--c:${c}" aria-label="Highlight ${k}"></button>`).join('') + '<span class="sep"></span>' : ''}
      <button data-s="note">${icon('note')}<span>Note</span></button>
      <button data-s="define">${icon('define')}<span>Define</span></button>
      ${sup.tts ? `<button data-s="speak">${icon('speaker')}<span>Speak</span></button>` : ''}
      <button data-s="copy">${icon('copy')}<span>Copy</span></button>`;
    bar.hidden = false;
    bar.onclick = e => {
      const hl = e.target.closest('[data-hl]');
      const act = e.target.closest('[data-s]')?.dataset.s;
      const s = this.selection;
      if (!s) return;
      if (hl) { this.addHighlight(s, hl.dataset.hl); return; }
      if (act === 'note') this.addNote(s);
      else if (act === 'define') defineWord(s.text);
      else if (act === 'speak') TTS.speakOnce(s.text);
      else if (act === 'copy') { copyText(s.text); this.endSelection(); }
    };
  },
  onSelectClear() {
    this.selection = null;
    if (this.el) $('.selbar', this.el).hidden = true;
  },
  endSelection() { this.engine?.clearSelection(); this.onSelectClear(); },

  async addHighlight(sel, color = 'yellow', note = '') {
    const n = {
      id: uid(), bookId: this.rec.id, type: this.engine.supports.highlight ? 'highlight' : 'note',
      pos: sel.pos, text: sel.text, note, color,
      label: this.loc?.label || '', chapter: this.loc?.chapter || '', created: Date.now()
    };
    await DB.put('notes', n);
    this.notes.push(n);
    this.engine.setNotes(this.notes);
    this.endSelection();
    return n;
  },
  async addNote(sel) {
    const text = sel.text;
    this.endSelection();
    const note = await promptDialog('Add a note', '', { multiline: true, quote: text, placeholder: 'Your thoughts…' });
    if (note == null) return;
    await this.addHighlight({ ...sel, text }, 'yellow', note.trim());
    toast('Note saved');
  },

  async onHighlightTap(id) {
    const n = this.notes.find(x => x.id === id);
    if (!n) return;
    const s = openSheet({
      className: 'menu',
      body: `
        <blockquote class="hl-quote" style="--c:${HL_COLORS[n.color] || HL_COLORS.yellow}">${esc(n.text)}</blockquote>
        ${n.note ? `<p class="hl-note">${esc(n.note)}</p>` : ''}
        <div class="swatch-row">${Object.entries(HL_COLORS).map(([k, c]) => `<button class="swatch ${n.color === k ? 'on' : ''}" data-hl="${k}" style="--c:${c}" aria-label="${k}"></button>`).join('')}</div>
        <button class="menu-item" data-a="note">${icon('note')}${n.note ? 'Edit note' : 'Add note'}</button>
        <button class="menu-item" data-a="define">${icon('define')}Define</button>
        <button class="menu-item" data-a="copy">${icon('copy')}Copy</button>
        <button class="menu-item danger" data-a="del">${icon('trash')}Delete highlight</button>`
    });
    s.body.addEventListener('click', async e => {
      const hl = e.target.closest('[data-hl]');
      if (hl) {
        n.color = hl.dataset.hl;
        await DB.put('notes', n);
        this.engine.setNotes(this.notes);
        s.close();
        return;
      }
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      s.close();
      if (a === 'note') await this.editNote(n);
      else if (a === 'define') defineWord(n.text);
      else if (a === 'copy') copyText(n.text);
      else if (a === 'del') await this.deleteNote(n);
    });
  },
  async editNote(n) {
    const v = await promptDialog(n.note ? 'Edit note' : 'Add a note', n.note || '', { multiline: true, quote: n.text });
    if (v == null) return;
    n.note = v.trim();
    await DB.put('notes', n);
  },
  async deleteNote(n) {
    await DB.del('notes', n.id);
    this.notes = this.notes.filter(x => x.id !== n.id);
    this.engine.setNotes(this.notes);
    this.updateRibbon();
  },

  // ---------- Contents / Notebook / Bookmarks drawer ----------
  async panel(tab = 'contents') {
    const sup = this.engine.supports;
    const toc = sup.toc ? await this.engine.toc() : [];
    if (tab === 'contents' && !toc.length) tab = 'notes';
    const s = openSheet({ side: true, className: 'panel', body: '' });
    const render = () => {
      const notes = this.sortedNotes().filter(n => n.type !== 'bookmark');
      const bms = this.sortedNotes().filter(n => n.type === 'bookmark');
      const curTarget = this.engine.currentChapterTarget?.();
      s.body.innerHTML = `
        <div class="panel-head">
          <div class="panel-book">${esc(this.rec.title)}</div>
          <div class="tabs">
            ${toc.length ? `<button class="tab ${tab === 'contents' ? 'on' : ''}" data-tab="contents">Contents</button>` : ''}
            <button class="tab ${tab === 'notes' ? 'on' : ''}" data-tab="notes">Notebook${notes.length ? ` (${notes.length})` : ''}</button>
            <button class="tab ${tab === 'bookmarks' ? 'on' : ''}" data-tab="bookmarks">Bookmarks${bms.length ? ` (${bms.length})` : ''}</button>
          </div>
        </div>
        <div class="panel-list">
          ${tab === 'contents' ? toc.map(t => `<button class="toc-item ${t.target === curTarget ? 'on' : ''}" style="--d:${t.depth}" data-go="${esc(String(t.target))}">${esc(t.label || 'Untitled')}${typeof t.target === 'number' ? `<span>${t.target}</span>` : ''}</button>`).join('') : ''}
          ${tab === 'notes' ? `
            <div class="panel-tools">
              ${!sup.highlight ? `<button class="link-btn" data-pa="page-note">${icon('plus')}Note on this page</button>` : ''}
              ${notes.length ? `<button class="link-btn" data-pa="export">${icon('share')}Export</button>` : ''}
            </div>
            ${notes.length ? notes.map(n => `
              <div class="nb-item">
                <button class="nb-main" data-go="${esc(String(n.pos))}">
                  <div class="nb-meta"><span class="dot" style="--c:${n.type === 'highlight' ? HL_COLORS[n.color] || HL_COLORS.yellow : 'transparent'}"></span>${esc([n.chapter, n.label].filter(Boolean).join(' · '))}</div>
                  ${n.text ? `<div class="nb-text">${esc(n.text)}</div>` : ''}
                  ${n.note ? `<div class="nb-note">${icon('note')}${esc(n.note)}</div>` : ''}
                </button>
                <div class="nb-actions">
                  <button class="icon-btn" data-edit="${n.id}" aria-label="Edit note">${icon('note')}</button>
                  <button class="icon-btn" data-del="${n.id}" aria-label="Delete">${icon('trash')}</button>
                </div>
              </div>`).join('') : `<p class="muted pad">${sup.highlight ? 'Select text and choose a colour to highlight it, or Note to add your thoughts. Everything you mark appears here.' : 'Select text and tap Note, or add a note to the current page.'}</p>`}` : ''}
          ${tab === 'bookmarks' ? (bms.length ? bms.map(n => `
              <div class="nb-item">
                <button class="nb-main" data-go="${esc(String(n.pos))}">
                  <div class="nb-meta">${icon('bookmark', 'tiny')}${esc([n.chapter, n.label].filter(Boolean).join(' · '))}</div>
                  ${n.text ? `<div class="nb-text dim">${esc(n.text)}…</div>` : ''}
                </button>
                <div class="nb-actions"><button class="icon-btn" data-del="${n.id}" aria-label="Delete">${icon('trash')}</button></div>
              </div>`).join('') : '<p class="muted pad">Tap the bookmark icon at the top while reading to mark a page.</p>') : ''}
        </div>`;
    };
    render();
    s.body.addEventListener('click', async e => {
      const tabB = e.target.closest('[data-tab]');
      if (tabB) { tab = tabB.dataset.tab; render(); return; }
      const del = e.target.closest('[data-del]');
      if (del) {
        const n = this.notes.find(x => x.id === del.dataset.del);
        if (n && await confirmDialog(n.type === 'bookmark' ? 'Delete this bookmark?' : 'Delete this highlight and its note?', 'Delete', true)) { await this.deleteNote(n); render(); }
        return;
      }
      const ed = e.target.closest('[data-edit]');
      if (ed) {
        const n = this.notes.find(x => x.id === ed.dataset.edit);
        if (n) { await this.editNote(n); render(); }
        return;
      }
      const pa = e.target.closest('[data-pa]')?.dataset.pa;
      if (pa === 'export') { this.exportNotes(); return; }
      if (pa === 'page-note') {
        const v = await promptDialog(`Note on ${this.loc?.label || 'this page'}`, '', { multiline: true });
        if (v && v.trim()) {
          const n = { id: uid(), bookId: this.rec.id, type: 'note', pos: this.loc.key, text: '', note: v.trim(), color: 'yellow', label: this.loc.label, chapter: this.loc.chapter, created: Date.now() };
          await DB.put('notes', n);
          this.notes.push(n);
          render();
        }
        return;
      }
      const go = e.target.closest('[data-go]');
      if (go) {
        const target = this.engine.kind === 'epub' ? go.dataset.go : Number(go.dataset.go);
        s.close();
        this.hideChrome();
        await this.engine.goto(target);
      }
    });
  },

  sortedNotes() {
    const cmp = this.engine.compare;
    return [...this.notes].sort((a, b) => cmp(a.pos, b.pos) || a.created - b.created);
  },

  exportNotes() {
    const notes = this.sortedNotes().filter(n => n.type !== 'bookmark');
    const lines = [`${this.rec.title}${this.rec.author ? ` — ${this.rec.author}` : ''}`, `Notes and highlights · exported ${formatDate(Date.now())}`, ''];
    for (const n of notes) {
      lines.push(`[${[n.chapter, n.label].filter(Boolean).join(' · ')}]`);
      if (n.text) lines.push(`“${n.text}”`);
      if (n.note) lines.push(`Note: ${n.note}`);
      lines.push('');
    }
    const safe = this.rec.title.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'notes';
    shareText(`${safe} - notes.txt`, lines.join('\n'));
  },

  // ---------- Search ----------
  search() {
    const s = openSheet({
      side: true,
      className: 'panel',
      body: `
        <div class="panel-head">
          <div class="search-box">${icon('search')}<input type="search" placeholder="Search this book" enterkeyhint="search" autocomplete="off"></div>
        </div>
        <div class="panel-list search-results"><p class="muted pad">Type a word or phrase and press Search.</p></div>`
    });
    const input = $('input', s.body);
    const out = $('.search-results', s.body);
    setTimeout(() => input.focus(), 250);
    let runId = 0;
    const run = async () => {
      const q = input.value.trim();
      if (q.length < 2) return;
      const my = ++runId;
      out.innerHTML = '<p class="muted pad searching">Searching…</p>';
      const results = await this.engine.search(q, pct => {
        if (my === runId) { const p = $('.searching', out); if (p) p.textContent = `Searching… ${pct}%`; }
      });
      if (my !== runId) return;
      if (!results.length) { out.innerHTML = `<p class="muted pad">No results for “${esc(q)}”.</p>`; return; }
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      out.innerHTML = `<p class="muted pad small">${results.length}${results.length >= 300 ? '+' : ''} results</p>` + results.map(r => `
        <button class="result" data-go="${esc(String(r.target))}">
          ${r.label ? `<div class="nb-meta">${esc(r.label)}</div>` : ''}
          <div class="res-text">${esc(r.excerpt).replace(re, m => `<mark>${m}</mark>`)}</div>
        </button>`).join('');
    };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); run(); } });
    input.addEventListener('search', run);
    out.addEventListener('click', async e => {
      const go = e.target.closest('[data-go]');
      if (!go) return;
      const target = this.engine.kind === 'epub' ? go.dataset.go : Number(go.dataset.go);
      s.close();
      this.hideChrome();
      await this.engine.goto(target);
      if (this.engine.kind === 'epub') setTimeout(() => this.engine.flash(target), 300);
    });
  },

  // ---------- Aa display panel ----------
  aaPanel() {
    const sup = this.engine.supports;
    const s = openSheet({ title: 'Display', className: 'aa' });
    const st = this.settings;
    const seg = (key, opts) => `<div class="seg">${opts.map(([v, label]) => `<button class="${st[key] === v ? 'on' : ''}" data-set="${key}" data-v="${esc(String(v))}">${label}</button>`).join('')}</div>`;
    const render = () => {
      s.body.innerHTML = `
        <div class="aa-row themes">
          ${Object.entries(THEMES).map(([k, t]) => `<button class="theme-chip ${st.theme === k ? 'on' : ''}" data-set="theme" data-v="${k}" style="--bg:${t.bg};--fg:${t.fg}"><span>Aa</span>${k[0].toUpperCase() + k.slice(1)}</button>`).join('')}
        </div>
        ${sup.typography ? `
          <div class="aa-label">Font</div>
          <div class="font-row">${FONTS.map(f => `<button class="font-chip ${st.font === f.id ? 'on' : ''}" data-set="font" data-v="${f.id}" style="${f.css ? `font-family:${esc(f.css)}` : ''}">${esc(f.label)}</button>`).join('')}</div>
          <div class="aa-label">Size</div>
          <div class="size-row">
            <button class="icon-btn" data-step="-1" aria-label="Smaller"><span style="font-size:14px">A</span></button>
            <input type="range" min="0" max="${SIZES.length - 1}" value="${st.size}" data-range="size" aria-label="Text size">
            <button class="icon-btn" data-step="1" aria-label="Larger"><span style="font-size:24px">A</span></button>
          </div>
          <div class="aa-grid">
            <div><div class="aa-label">Line spacing</div>${seg('lh', [['tight', lines(3)], ['normal', lines(2)], ['loose', lines(1)]])}</div>
            <div><div class="aa-label">Margins</div>${seg('margin', [['narrow', margin(1)], ['medium', margin(2)], ['wide', margin(3)]])}</div>
            <div><div class="aa-label">Alignment</div>${seg('align', [['justify', 'Justified'], ['left', 'Left'], ['publisher', 'Original']])}</div>
            <div><div class="aa-label">Columns (landscape)</div>${seg('columns', [['auto', 'Two'], ['single', 'One']])}</div>
          </div>` : ''}
        ${sup.pdf ? `
          <div class="aa-grid">
            <div><div class="aa-label">Page fit</div>${seg('pdfFit', [['page', 'Whole page'], ['width', 'Fit width']])}</div>
            <div><div class="aa-label">Dark pages in Black theme</div>${seg('pdfDark', [[true, 'On'], [false, 'Off']])}</div>
          </div>` : ''}
        ${sup.comic ? `
          <div class="aa-grid">
            <div><div class="aa-label">Reading direction</div>${seg('comicDir', [['ltr', 'Left to right'], ['rtl', 'Manga (right to left)']])}</div>
            <div><div class="aa-label">Two pages in landscape</div>${seg('comicSpread', [[true, 'On'], [false, 'Off']])}</div>
            <div><div class="aa-label">Page fit</div>${seg('comicFit', [['page', 'Whole page'], ['width', 'Fit width']])}</div>
          </div>` : ''}
        <div class="aa-label">Dim screen</div>
        <div class="size-row">${icon('sun', 'small')}<input type="range" min="0" max="70" value="${st.dim || 0}" data-range="dim" aria-label="Dim">${icon('sun')}</div>
        <p class="muted small">For the brightest or darkest settings, also use your iPad's Control Centre.</p>`;
    };
    render();
    s.body.addEventListener('click', e => {
      const b = e.target.closest('[data-set]');
      const step = e.target.closest('[data-step]');
      if (b) {
        let v = b.dataset.v;
        if (v === 'true') v = true; else if (v === 'false') v = false;
        st[b.dataset.set] = v;
      } else if (step) {
        st.size = Math.max(0, Math.min(SIZES.length - 1, st.size + Number(step.dataset.step)));
      } else return;
      this.applySettings();
      render();
    });
    s.body.addEventListener('input', e => {
      const k = e.target.dataset.range;
      if (!k) return;
      st[k] = Number(e.target.value);
      if (k === 'dim') { $('.r-dim', this.el).style.opacity = st.dim / 100; this.saveSettings(); }
    });
    s.body.addEventListener('change', e => {
      if (e.target.dataset.range === 'size') this.applySettings();
    });
  }
};

function lines(n) {
  const gap = [0, 7, 5, 3.5][n];
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${[0, 1, 2].map(i => `<path d="M5 ${12 + (i - 1) * gap}h14"/>`).join('')}</svg>`;
}
function margin(n) {
  const m = [0, 4, 6.5, 9][n];
  return `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M${3 + m} 8.5h${18 - 2 * m}M${3 + m} 12h${18 - 2 * m}M${3 + m} 15.5h${18 - 2 * m}" stroke-linecap="round"/></svg>`;
}

function setThemeColor(c) {
  const m = document.querySelector('meta[name=theme-color]');
  if (m) m.setAttribute('content', c);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Copied'); } catch { toast('Couldn’t copy'); }
    ta.remove();
  }
}

// ---------- Dictionary ----------
async function defineWord(raw) {
  const text = raw.trim().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!text) return;
  if (text.split(/\s+/).length > 3) { toast('Select a single word or short phrase to define'); return; }
  const s = openSheet({ title: text, className: 'define', body: '<div class="spinner"></div>' });
  const tip = '<p class="muted small">Your iPad also has a built-in dictionary that works offline: select a word and tap <b>Look Up</b> in the menu that appears.</p>';
  if (!navigator.onLine) {
    s.body.innerHTML = `<p>No internet connection, so the online dictionary isn't available right now.</p>${tip}`;
    return;
  }
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(text.toLowerCase())}`, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.status === 404) { s.body.innerHTML = `<p>No definition found for “${esc(text)}”.</p>${tip}`; return; }
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const phon = data.map(d => d.phonetic || (d.phonetics || []).map(p => p.text).find(Boolean)).find(Boolean);
    let html = phon ? `<div class="phon">${esc(phon)}</div>` : '';
    const seen = new Set();
    for (const entry of data) {
      for (const m of entry.meanings || []) {
        const defs = (m.definitions || []).filter(d => !seen.has(d.definition)).slice(0, 3);
        if (!defs.length) continue;
        defs.forEach(d => seen.add(d.definition));
        html += `<div class="pos">${esc(m.partOfSpeech || '')}</div><ol>${defs.map(d => `<li>${esc(d.definition)}${d.example ? `<div class="ex">“${esc(d.example)}”</div>` : ''}</li>`).join('')}</ol>`;
        if (m.synonyms?.length) html += `<div class="syn">Similar: ${esc(m.synonyms.slice(0, 6).join(', '))}</div>`;
      }
    }
    s.body.innerHTML = html + `<p class="muted small src">Definitions from Wiktionary (via dictionaryapi.dev).</p>${tip}`;
  } catch {
    s.body.innerHTML = `<p>Couldn't reach the online dictionary.</p>${tip}`;
  }
}

// ---------- Read aloud ----------
const RATES = [0.7, 0.85, 1, 1.15, 1.3, 1.5, 1.75, 2];
export const TTS = {
  active: false,
  paused: false,
  session: 0,
  chunks: [],
  idx: 0,
  awaitingTurn: false,
  wake: null,

  supported() { return 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window; },

  voices() {
    if (!this.supported()) return [];
    return speechSynthesis.getVoices().filter(v => /^en/i.test(v.lang)).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
  },

  async start() {
    if (!this.supported()) { toast('Read aloud isn’t available on this device'); return; }
    if (this.active) { this.paused ? this.resume() : null; return; }
    this.active = true;
    this.paused = false;
    this.renderBar();
    try { this.wake = await navigator.wakeLock?.request('screen'); } catch { this.wake = null; }
    this.readPage();
  },

  async readPage() {
    const s = ++this.session;
    speechSynthesis.cancel();
    let text = '';
    try { text = await Reader.engine.pageText(); } catch { /* ignore */ }
    if (s !== this.session || !this.active) return;
    this.chunks = splitSentences(text);
    this.idx = 0;
    this.speakNext(s);
  },

  speakNext(s) {
    if (s !== this.session || !this.active || this.paused) return;
    if (this.idx >= this.chunks.length) { this.advance(); return; }
    const u = new SpeechSynthesisUtterance(this.chunks[this.idx]);
    const st = Reader.settings;
    u.rate = st.rate || 1;
    const v = this.voices().find(x => x.voiceURI === st.voice);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en';
    u.onend = () => { if (s !== this.session) return; this.idx++; this.speakNext(s); };
    u.onerror = e => {
      if (s !== this.session) return;
      if (e.error === 'interrupted' || e.error === 'canceled') return;
      this.idx++; this.speakNext(s);
    };
    speechSynthesis.speak(u);
  },

  advance() {
    const loc = Reader.loc;
    if (!loc || loc.atEnd) { this.stop(); toast('Finished reading aloud'); return; }
    this.awaitingTurn = true;
    Reader.engine.next();
  },

  onLocation() {
    if (!this.active) return;
    if (this.awaitingTurn) {
      this.awaitingTurn = false;
      setTimeout(() => this.readPage(), 250);
    } else if (!this.paused) {
      // You turned the page yourself: start reading the new page.
      this.readPage();
    }
  },

  pause() {
    this.paused = true;
    this.session++;
    speechSynthesis.cancel();
    this.renderBar();
  },

  resume() {
    if (!this.active) return;
    this.paused = false;
    this.renderBar();
    this.speakNext(++this.session);
  },

  restartChunk() {
    if (!this.active || this.paused) return;
    speechSynthesis.cancel();
    this.speakNext(++this.session);
  },

  stop() {
    this.active = false;
    this.paused = false;
    this.awaitingTurn = false;
    this.session++;
    if (this.supported()) speechSynthesis.cancel();
    try { this.wake?.release(); } catch { /* ignore */ }
    this.wake = null;
    const bar = Reader.el && $('.tts-bar', Reader.el);
    if (bar) bar.hidden = true;
  },

  speakOnce(text) {
    if (!this.supported()) { toast('Read aloud isn’t available on this device'); return; }
    if (this.active && !this.paused) this.pause();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = Reader.settings.rate || 1;
    const v = this.voices().find(x => x.voiceURI === Reader.settings.voice);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  },

  renderBar() {
    const bar = Reader.el && $('.tts-bar', Reader.el);
    if (!bar) return;
    const st = Reader.settings;
    const voices = this.voices();
    bar.hidden = false;
    bar.innerHTML = `
      <button class="icon-btn big" data-t="toggle" aria-label="${this.paused ? 'Play' : 'Pause'}">${icon(this.paused ? 'play' : 'pause')}</button>
      <div class="tts-info"><b>Reading aloud</b><span>${this.paused ? 'Paused' : 'Turns pages automatically'}</span></div>
      <label class="tts-sel">Speed
        <select data-t="rate">${RATES.map(r => `<option value="${r}" ${Number(st.rate || 1) === r ? 'selected' : ''}>${r}×</option>`).join('')}</select>
      </label>
      ${voices.length ? `<label class="tts-sel">Voice
        <select data-t="voice"><option value="">Default</option>${voices.map(v => `<option value="${esc(v.voiceURI)}" ${st.voice === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</select>
      </label>` : ''}
      <button class="icon-btn" data-t="stop" aria-label="Stop">${icon('close')}</button>`;
    bar.onclick = e => {
      const t = e.target.closest('[data-t]')?.dataset.t;
      if (t === 'toggle') this.paused ? this.resume() : this.pause();
      else if (t === 'stop') this.stop();
    };
    bar.onchange = e => {
      const t = e.target.dataset.t;
      if (t === 'rate') st.rate = Number(e.target.value);
      else if (t === 'voice') st.voice = e.target.value;
      else return;
      Reader.saveSettings();
      this.restartChunk();
    };
  }
};

if ('speechSynthesis' in window) {
  speechSynthesis.addEventListener?.('voiceschanged', () => { if (TTS.active) TTS.renderBar(); });
}

function splitSentences(text) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const parts = t.match(/[^.!?…।]+[.!?…।]+["'”’)\]]*\s*|[^.!?…।]+$/g) || [t];
  const out = [];
  for (let p of parts) {
    p = p.trim();
    if (!p || !/[\p{L}\p{N}]/u.test(p)) continue;
    while (p.length > 220) {
      let cut = p.lastIndexOf(', ', 200);
      if (cut < 80) cut = p.lastIndexOf(' ', 200);
      if (cut < 40) cut = 200;
      out.push(p.slice(0, cut + 1).trim());
      p = p.slice(cut + 1).trim();
    }
    if (p) {
      if (out.length && out[out.length - 1].length < 40 && (out[out.length - 1].length + p.length) < 200) out[out.length - 1] += ' ' + p;
      else out.push(p);
    }
  }
  return out;
}
