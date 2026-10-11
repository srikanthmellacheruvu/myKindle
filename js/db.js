// IndexedDB storage: books (metadata + cover), files (the book itself),
// notes (highlights, notes and bookmarks) and collections.

const NAME = 'myreader';
const VERSION = 1;
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'id' });
        s.createIndex('bookId', 'bookId');
      }
      if (!db.objectStoreNames.contains('collections')) db.createObjectStore('collections', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

const wrap = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export const DB = {
  async get(name, id) { return wrap((await store(name)).get(id)); },
  async all(name) { return wrap((await store(name)).getAll()); },
  async put(name, value) { return wrap((await store(name, 'readwrite')).put(value)); },
  async del(name, id) { return wrap((await store(name, 'readwrite')).delete(id)); },
  async notesFor(bookId) {
    const s = await store('notes');
    return wrap(s.index('bookId').getAll(bookId));
  },
  async deleteBook(id) {
    const db = await open();
    const notes = await this.notesFor(id);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(['books', 'files', 'notes'], 'readwrite');
      tx.objectStore('books').delete(id);
      tx.objectStore('files').delete(id);
      for (const n of notes) tx.objectStore('notes').delete(n.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
};
