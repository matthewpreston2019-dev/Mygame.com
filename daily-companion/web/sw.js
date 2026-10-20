// =============================================================================
// Service worker — makes the app open instantly and work offline, and shows
// push notifications (even when the app is closed).
// scripts/build.mjs fills in BUILD and PRECACHE on every deploy, so each deploy
// gets a fresh cache and the app can offer "Update ready".
// =============================================================================

const BUILD = '__BUILD__';
const PRECACHE = /*__PRECACHE__*/[];
const CACHE = `dc-${BUILD}`;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' bypasses the HTTP cache so we store the fresh files.
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('dc-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// The page asks us to activate right away after you tap "Update".
self.addEventListener('message', (event) => {
  if (event.data?.type === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase etc. always go to the network

  // Page loads: answer from cache instantly (the app syncs data itself).
  if (req.mode === 'navigate') {
    const page = url.pathname.endsWith('/download.html') || url.pathname.endsWith('/download') ? 'download.html' : 'index.html';
    event.respondWith((async () => {
      const cached = await caches.match(page, { ignoreSearch: true });
      if (cached) return cached;
      try { return await fetch(req); } catch { return new Response('Offline', { status: 503 }); }
    })());
    return;
  }

  // Files: cache first, then network (and remember it for next time).
  event.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy));
    }
    return res;
  })());
});

// ---- Push notifications --------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text() }; }
  const title = data.title || 'Daily Companion';
  event.waitUntil((async () => {
    // iOS requires every push to show a notification, so we always do.
    await self.registration.showNotification(title, {
      body: data.body || '',
      icon: 'icons/icon-192.png',
      badge: 'icons/favicon-32.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url: data.url || './#/coach' },
      timestamp: Date.now(),
    });
    if (typeof data.badge === 'number' && self.navigator.setAppBadge) {
      try { data.badge > 0 ? await self.navigator.setAppBadge(data.badge) : await self.navigator.clearAppBadge(); } catch { /* unsupported */ }
    }
    // If the app is open, tell it to fetch the new message.
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'sync' });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './#/coach', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of wins) {
      if (w.url.startsWith(self.registration.scope)) {
        await w.focus();
        w.postMessage({ type: 'navigate', url: target });
        w.postMessage({ type: 'sync' });
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});
