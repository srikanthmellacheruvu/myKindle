// The library (home) screen: covers, filters, collections and book actions.
import { DB } from './db.js';
import { $, $$, esc, icon, store, toast, openSheet, confirmDialog, promptDialog, coverUrl, dropCoverUrl, formatBytes, formatDate, uid } from './util.js';
import { importFiles, reportImport } from './importer.js';

const FORMAT_LABEL = { epub: 'EPUB', pdf: 'PDF', txt: 'Text', cbz: 'Comic' };
const SORTS = { recent: 'Recent', title: 'Title', author: 'Author', added: 'Date added' };

export const Library = {
  books: [],
  collections: [],
  state: Object.assign({ filter: 'all', sort: 'recent', view: 'grid' }, store.get('lib', {})),
  query: '',
  root: null,
  onOpen: null,

  async load() {
    [this.books, this.collections] = await Promise.all([DB.all('books'), DB.all('collections')]);
    this.collections.sort((a, b) => a.name.localeCompare(b.name));
    if (this.state.filter.startsWith('col:') && !this.collections.some(c => 'col:' + c.id === this.state.filter)) this.state.filter = 'all';
  },

  save() { store.set('lib', this.state); },

  async show(root) {
    this.root = root;
    await this.load();
    root.innerHTML = `
      <div class="lib">
        <header class="lib-head">
          <div class="lib-row">
            <h1>Library</h1>
            <div class="lib-actions">
              <button class="icon-btn" data-act="search" aria-label="Search">${icon('search')}</button>
              <button class="icon-btn" data-act="sort" aria-label="Sort">${icon('sort')}</button>
              <button class="icon-btn" data-act="view" aria-label="Change view">${icon(this.state.view === 'grid' ? 'list' : 'grid')}</button>
              <button class="icon-btn" data-act="settings" aria-label="Settings">${icon('gear')}</button>
              <label class="btn primary add-btn">${icon('plus')}<span>Add books</span><input class="vh" type="file" multiple></label>
            </div>
          </div>
          <div class="lib-search" ${this.query ? '' : 'hidden'}>
            ${icon('search')}<input type="search" placeholder="Search titles and authors" value="${esc(this.query)}" autocomplete="off">
            <button class="icon-btn" data-act="clear-search" aria-label="Close search">${icon('close')}</button>
          </div>
          <nav class="chips"></nav>
        </header>
        <main class="lib-main"></main>
      </div>`;
    this.bind();
    this.renderChips();
    this.renderBooks();
  },

  bind() {
    const root = this.root;
    root.addEventListener('click', e => this.onClick(e));
    $('input[type=file]', root).addEventListener('change', async e => {
      const files = Array.from(e.target.files || []);
      e.target.value = '';
      if (files.length) await this.addFiles(files);
    });
    $('.lib-search input', root).addEventListener('input', e => { this.query = e.target.value; this.renderBooks(); });
    // Drag and drop (handy on a computer).
    root.addEventListener('dragover', e => { e.preventDefault(); });
    root.addEventListener('drop', async e => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files || []);
      if (files.length) await this.addFiles(files);
    });
  },

  async addFiles(files) {
    const bar = document.createElement('div');
    bar.className = 'import-bar';
    bar.innerHTML = '<div class="spinner"></div><span>Adding books…</span>';
    document.body.appendChild(bar);
    try {
      const result = await importFiles(files, msg => { $('span', bar).textContent = msg; });
      reportImport(result);
      if (result.added.length && this.state.filter !== 'all') { this.state.filter = 'all'; this.save(); }
    } finally {
      bar.remove();
    }
    await this.load();
    this.renderChips();
    this.renderBooks();
  },

  async onClick(e) {
    const t = e.target.closest('[data-act],[data-open],[data-more],[data-chip]');
    if (!t) return;
    if (t.dataset.open) { this.open(t.dataset.open); return; }
    if (t.dataset.more) { this.bookMenu(t.dataset.more); return; }
    if (t.dataset.chip) {
      if (t.dataset.chip === 'new-col') { await this.newCollection(); return; }
      this.state.filter = t.dataset.chip; this.save();
      this.renderChips(); this.renderBooks();
      return;
    }
    switch (t.dataset.act) {
      case 'search': {
        const box = $('.lib-search', this.root);
        box.hidden = false;
        $('input', box).focus();
        break;
      }
      case 'clear-search':
        this.query = '';
        $('.lib-search input', this.root).value = '';
        $('.lib-search', this.root).hidden = true;
        this.renderBooks();
        break;
      case 'sort': this.sortMenu(); break;
      case 'view':
        this.state.view = this.state.view === 'grid' ? 'list' : 'grid';
        this.save();
        t.innerHTML = icon(this.state.view === 'grid' ? 'list' : 'grid');
        this.renderBooks();
        break;
      case 'settings': this.settings(); break;
      case 'manage-col': this.manageCollection(t.dataset.id); break;
    }
  },

  open(id) {
    const book = this.books.find(b => b.id === id);
    if (book) this.onOpen?.(book);
  },

  renderChips() {
    const f = this.state.filter;
    const chip = (key, label) => `<button class="chip ${f === key ? 'on' : ''}" data-chip="${esc(key)}">${esc(label)}</button>`;
    $('.chips', this.root).innerHTML =
      chip('all', 'All') + chip('reading', 'Reading') + chip('unread', 'Unread') + chip('finished', 'Finished') +
      (this.collections.length ? '<span class="chip-sep"></span>' : '') +
      this.collections.map(c => chip('col:' + c.id, c.name)).join('') +
      `<button class="chip add" data-chip="new-col">${icon('plus')}Collection</button>`;
    const on = $('.chip.on', this.root);
    on?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  },

  filtered() {
    const f = this.state.filter;
    const q = this.query.trim().toLowerCase();
    let list = this.books.filter(b => {
      if (f === 'reading' && !(b.status === 'reading')) return false;
      if (f === 'unread' && b.status !== 'unread') return false;
      if (f === 'finished' && b.status !== 'finished') return false;
      if (f.startsWith('col:') && !(b.collections || []).includes(f.slice(4))) return false;
      if (q && !(`${b.title} ${b.author}`.toLowerCase().includes(q))) return false;
      return true;
    });
    const by = this.state.sort;
    const cmp = {
      recent: (a, b) => (b.lastOpened || b.added) - (a.lastOpened || a.added),
      title: (a, b) => sortTitle(a.title).localeCompare(sortTitle(b.title)),
      author: (a, b) => (lastName(a.author) || '￿').localeCompare(lastName(b.author) || '￿') || sortTitle(a.title).localeCompare(sortTitle(b.title)),
      added: (a, b) => b.added - a.added
    }[by] || (() => 0);
    return list.sort(cmp);
  },

  renderBooks() {
    const main = $('.lib-main', this.root);
    if (!this.books.length) {
      main.innerHTML = `
        <div class="empty">
          <div class="empty-art">${icon('book')}</div>
          <h2>Your library is empty</h2>
          <p>Tap <b>Add books</b> and choose EPUB, PDF, TXT or CBZ files from the Files app — iCloud Drive or On My iPad.</p>
          <p class="muted">Books bought from online stores are usually copy-protected and won't open here. DRM-free books, public-domain classics and your own documents work.</p>
        </div>`;
      return;
    }
    const list = this.filtered();
    const f = this.state.filter;
    let cont = '';
    if (f === 'all' && !this.query) {
      const cur = this.books.filter(b => b.lastOpened && b.status === 'reading').sort((a, b) => b.lastOpened - a.lastOpened)[0];
      if (cur) {
        cont = `
          <section class="continue" data-open="${cur.id}">
            <img class="continue-cover" src="${coverUrl(cur)}" alt="">
            <div class="continue-info">
              <div class="eyebrow">Continue reading</div>
              <div class="continue-title">${esc(cur.title)}</div>
              ${cur.author ? `<div class="continue-author">${esc(cur.author)}</div>` : ''}
              <div class="bar"><span style="width:${Math.round((cur.progress || 0) * 100)}%"></span></div>
              <div class="continue-pct">${Math.round((cur.progress || 0) * 100)}% read</div>
            </div>
          </section>`;
      }
    }
    const label = f.startsWith('col:') ? (this.collections.find(c => 'col:' + c.id === f)?.name || '') : '';
    main.innerHTML = cont + `
      <div class="list-head">
        <span>${list.length} ${list.length === 1 ? 'item' : 'items'}${label ? ` in ${esc(label)}` : ''} · ${SORTS[this.state.sort]}</span>
        ${f.startsWith('col:') ? `<button class="link-btn" data-act="manage-col" data-id="${esc(f.slice(4))}">Edit collection</button>` : ''}
      </div>
      ${list.length ? `<div class="books ${this.state.view}">${list.map(b => this.tile(b)).join('')}</div>`
        : `<p class="none">${this.query ? 'No books match your search.' : 'Nothing here yet.'}</p>`}`;
  },

  tile(b) {
    const pct = Math.round((b.progress || 0) * 100);
    const badge = b.status === 'unread' ? '<span class="badge">New</span>'
      : b.status === 'finished' ? `<span class="badge done">${icon('check')}</span>` : '';
    const sub = b.status === 'finished' ? 'Finished' : b.status === 'reading' ? `${pct}%` : FORMAT_LABEL[b.format];
    return `
      <div class="tile">
        <button class="cover" data-open="${b.id}" aria-label="Open ${esc(b.title)}">
          <img src="${coverUrl(b)}" alt="" loading="lazy">
          ${badge}
          ${b.status === 'reading' ? `<span class="cover-bar"><span style="width:${pct}%"></span></span>` : ''}
        </button>
        <div class="tile-meta" data-open="${b.id}">
          <div class="t-title">${esc(b.title)}</div>
          <div class="t-author">${esc(b.author || '')}</div>
          <div class="t-sub">${esc(sub)}${this.state.view === 'list' ? ` · ${FORMAT_LABEL[b.format]}` : ''}</div>
        </div>
        <button class="icon-btn tile-more" data-more="${b.id}" aria-label="More">${icon('more')}</button>
      </div>`;
  },

  sortMenu() {
    const s = openSheet({
      title: 'Sort by',
      className: 'menu',
      body: Object.entries(SORTS).map(([k, v]) => `<button class="menu-item ${this.state.sort === k ? 'on' : ''}" data-k="${k}">${esc(v)}${this.state.sort === k ? icon('check') : ''}</button>`).join('')
    });
    s.body.addEventListener('click', e => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      this.state.sort = b.dataset.k; this.save();
      s.close(); this.renderBooks();
    });
  },

  async bookMenu(id) {
    const b = this.books.find(x => x.id === id);
    if (!b) return;
    const s = openSheet({
      className: 'menu',
      body: `
        <div class="book-card">
          <img src="${coverUrl(b)}" alt="">
          <div>
            <div class="bc-title">${esc(b.title)}</div>
            ${b.author ? `<div class="bc-author">${esc(b.author)}</div>` : ''}
            <div class="bc-meta">${FORMAT_LABEL[b.format]} · ${formatBytes(b.size)}${b.pages ? ` · ${b.pages} pages` : ''}</div>
            <div class="bc-meta">Added ${formatDate(b.added)}${b.lastOpened ? ` · Last read ${formatDate(b.lastOpened)}` : ''}</div>
          </div>
        </div>
        <button class="menu-item" data-a="read">${icon('book')}${b.status === 'reading' ? 'Continue reading' : 'Read'}</button>
        <button class="menu-item" data-a="cols">${icon('folder')}Add to collection…</button>
        <button class="menu-item" data-a="status">${icon('check')}${b.status === 'finished' ? 'Mark as unread' : 'Mark as finished'}</button>
        <button class="menu-item" data-a="edit">${icon('note')}Edit title and author</button>
        <button class="menu-item danger" data-a="delete">${icon('trash')}Remove from library</button>`
    });
    s.body.addEventListener('click', async e => {
      const t = e.target.closest('[data-a]');
      if (!t) return;
      const a = t.dataset.a;
      s.close();
      if (a === 'read') this.open(id);
      else if (a === 'cols') this.collectionPicker(b);
      else if (a === 'status') {
        if (b.status === 'finished') { b.status = 'unread'; b.progress = 0; b.pos = null; } else { b.status = 'finished'; b.progress = 1; }
        await DB.put('books', b);
        this.renderBooks();
      } else if (a === 'edit') {
        const title = await promptDialog('Title', b.title);
        if (title == null) return;
        const author = await promptDialog('Author', b.author, { placeholder: 'Unknown author' });
        if (author == null) return;
        b.title = title.trim() || b.title;
        b.author = author.trim();
        await DB.put('books', b);
        this.renderBooks();
      } else if (a === 'delete') {
        if (!await confirmDialog(`Remove “${b.title}” and its notes and highlights from this iPad?`, 'Remove', true)) return;
        await DB.deleteBook(b.id);
        dropCoverUrl(b.id);
        await this.load();
        this.renderBooks();
        toast('Removed');
      }
    });
  },

  collectionPicker(b) {
    const render = () => `
      ${this.collections.length ? this.collections.map(c => `
        <label class="check-row"><input type="checkbox" data-c="${c.id}" ${(b.collections || []).includes(c.id) ? 'checked' : ''}><span>${esc(c.name)}</span></label>`).join('')
        : '<p class="muted pad">No collections yet.</p>'}
      <button class="menu-item" data-new>${icon('plus')}New collection</button>`;
    const s = openSheet({ title: 'Collections', className: 'menu', body: render() });
    s.body.addEventListener('change', async e => {
      const id = e.target.dataset.c;
      if (!id) return;
      const set = new Set(b.collections || []);
      if (e.target.checked) set.add(id); else set.delete(id);
      b.collections = [...set];
      await DB.put('books', b);
      this.renderBooks();
    });
    s.body.addEventListener('click', async e => {
      if (!e.target.closest('[data-new]')) return;
      const c = await this.newCollection(true);
      if (c) {
        b.collections = [...(b.collections || []), c.id];
        await DB.put('books', b);
        s.body.innerHTML = render();
        this.renderBooks();
      }
    });
  },

  async newCollection(silent) {
    const name = (await promptDialog('New collection', '', { placeholder: 'e.g. Telugu classics, To read', okLabel: 'Create' }) || '').trim();
    if (!name) return null;
    const c = { id: uid(), name };
    await DB.put('collections', c);
    await this.load();
    if (!silent) this.state.filter = 'col:' + c.id;
    this.save();
    this.renderChips();
    this.renderBooks();
    return c;
  },

  async manageCollection(id) {
    const c = this.collections.find(x => x.id === id);
    if (!c) return;
    const s = openSheet({
      title: c.name,
      className: 'menu',
      body: `<button class="menu-item" data-a="rename">${icon('note')}Rename</button>
             <button class="menu-item danger" data-a="delete">${icon('trash')}Delete collection</button>
             <p class="muted pad">Deleting a collection keeps its books in your library.</p>`
    });
    s.body.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      s.close();
      if (a === 'rename') {
        const name = (await promptDialog('Rename collection', c.name) || '').trim();
        if (!name) return;
        c.name = name;
        await DB.put('collections', c);
      } else {
        if (!await confirmDialog(`Delete the collection “${c.name}”?`, 'Delete', true)) return;
        await DB.del('collections', c.id);
        for (const b of this.books) {
          if ((b.collections || []).includes(c.id)) {
            b.collections = b.collections.filter(x => x !== c.id);
            await DB.put('books', b);
          }
        }
        this.state.filter = 'all';
        this.save();
      }
      await this.load();
      this.renderChips();
      this.renderBooks();
    });
  },

  async settings() {
    let usage = '';
    try {
      const est = await navigator.storage?.estimate?.();
      if (est) usage = `${formatBytes(est.usage)} used`;
    } catch { /* ignore */ }
    let persisted = false;
    try { persisted = await navigator.storage?.persisted?.(); } catch { /* ignore */ }
    const total = this.books.reduce((n, b) => n + (b.size || 0), 0);
    const standalone = window.navigator.standalone || matchMedia('(display-mode: standalone)').matches;
    const s = openSheet({
      title: 'Settings',
      className: 'menu',
      body: `
        <div class="kv"><span>Books</span><b>${this.books.length} · ${formatBytes(total)}</b></div>
        <div class="kv"><span>Storage on this iPad</span><b>${usage || '—'}</b></div>
        <div class="kv"><span>Protected from clean-up</span><b>${persisted ? 'Yes' : standalone ? 'Yes (Home Screen app)' : 'No — add to Home Screen'}</b></div>
        <button class="menu-item" data-a="speed">${icon('sun')}Reset reading speed (used for “time left”)</button>
        <button class="menu-item danger" data-a="wipe">${icon('trash')}Remove all books</button>
        <p class="muted pad">MyReader keeps your books, notes and highlights only on this iPad. Removing the app from your Home Screen or clearing Safari website data deletes them.</p>
        <p class="muted pad small">MyReader 1.0</p>`
    });
    s.body.addEventListener('click', async e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'speed') {
        store.set('speed', {});
        toast('Reading speed reset');
      } else if (a === 'wipe') {
        s.close();
        if (!await confirmDialog('Remove every book, note and highlight from this iPad? This cannot be undone.', 'Remove all', true)) return;
        for (const b of this.books) { await DB.deleteBook(b.id); dropCoverUrl(b.id); }
        await this.load();
        this.renderChips();
        this.renderBooks();
        toast('Library cleared');
      }
    });
  }
};

function sortTitle(t) { return (t || '').replace(/^(the|a|an)\s+/i, '').toLowerCase(); }
function lastName(a) {
  a = (a || '').split(/[,;&]| and /)[0].trim();
  if (!a) return '';
  return a.includes(' ') ? a.split(/\s+/).pop().toLowerCase() : a.toLowerCase();
}
