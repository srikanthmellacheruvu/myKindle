import { Library } from './library.js';
import { Reader } from './reader.js';

const app = document.getElementById('app');

function screen() {
  const el = document.createElement('div');
  el.className = 'screen';
  app.replaceChildren(el);
  return el;
}

async function showLibrary() {
  delete document.documentElement.dataset.ui;
  await Library.show(screen());
}

Library.onOpen = async book => {
  await Reader.open(book, screen());
};
Reader.onClose = () => showLibrary();

// Stop the whole app from zooming on pinch (reading views have their own controls).
document.addEventListener('gesturestart', e => e.preventDefault());

showLibrary();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('./sw.js').catch(err => console.warn('Offline support unavailable', err));
}
