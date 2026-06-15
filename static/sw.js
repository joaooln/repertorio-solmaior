// ══════════════════════════════════════════════════════════════════════
// Service Worker — Repertório Sol Maior
// Cache de assets estáticos para carregamento offline do shell
// ══════════════════════════════════════════════════════════════════════
const CACHE_NAME    = 'solmaior-shell-v16';
const SHELL_ASSETS  = [
  '/',
  '/static/app.js',
  '/static/idb.js',
  '/static/style.css',
  '/static/favicon.svg',
  '/static/manifest.json',
  'https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400;1,9..144,500&family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap',
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
