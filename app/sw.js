// Service worker: guarda só os arquivos do app (para abrir rápido e instalar). Dados do Supabase nunca passam por aqui.
const VERSAO = 'lm-v1';
const ARQUIVOS = ['./', './index.html', './style.css', './app.js', './config.js', './vendor/supabase.js', './manifest.webmanifest', './icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; // só arquivos do próprio app
  e.respondWith(
    fetch(req).then((r) => { if (r.ok) { const copia = r.clone(); caches.open(VERSAO).then((c) => c.put(req, copia)); } return r; })
      .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then((cs) => (cs[0] ? cs[0].focus() : self.clients.openWindow('./'))));
});
