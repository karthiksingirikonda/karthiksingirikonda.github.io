// Offline support: the app opens and works with no internet.
const V = 'measure-v11';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'css/app.css', 'icons/icon-192.png',
  'js/app.js', 'js/ui.js', 'js/db.js', 'js/util.js', 'js/units.js', 'js/help.js', 'js/cloud.js', 'js/config.js',
  'js/drawing.js', 'js/ui-drawing.js', 'js/sheet.js', 'js/ui-sheet.js', 'js/ui-plan.js', 'js/ar.js', 'js/ui-count.js', 'js/ui-photo.js', 'js/laser.js', 'js/ui-notes.js', 'js/categories.js',
  'vendor/pdf.min.mjs', 'vendor/pdf.worker.min.mjs', 'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
  'vendor/xlsx.full.min.js', 'vendor/exceljs.min.js', 'vendor/firebase.js', 'vendor/three.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(V).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/__/')) return;
  const isCode = /\.(js|html|css|webmanifest)$/.test(u.pathname) && !u.pathname.includes('/vendor/') || u.pathname.endsWith('/');
  if (isCode) { // network first so updates arrive; cache when offline
    e.respondWith(fetch(e.request, { cache: 'no-cache' }).then(r => { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request)));
  } else { // libraries and reading data: cache first (big files downloaded once)
    e.respondWith(caches.match(e.request).then(m => m || fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(V).then(x => x.put(e.request, c)); } return r; })));
  }
});
