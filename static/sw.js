// ══════════════════════════════════════════════════════════════════════
// Service Worker — Repertório Sol Maior
// Cache de assets estáticos para carregamento offline do shell
// ══════════════════════════════════════════════════════════════════════
const CACHE_NAME    = 'solmaior-shell-v3';
const SHELL_ASSETS  = [
  '/',
  '/static/app.js',
  '/static/idb.js',
  '/static/style.css',
  'https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;0,900;1,700&family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap',
];

// ── Install: pré-carrega o shell ───────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: remove caches antigas ───────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: shell via cache, API via rede ──────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Chamadas de API: deixa passar (gerenciadas pelo IDB no app)
  if (url.pathname.startsWith('/api/')) return;

  // Assets estáticos e HTML: cache-first, atualiza em background
  e.respondWith(
    caches.match(e.request).then(cached => {
      const netFetch = fetch(e.request).then(resp => {
        if (resp && resp.ok && e.request.method === 'GET') {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
        }
        return resp;
      }).catch(() => null);
      return cached || netFetch;
    })
  );
});
