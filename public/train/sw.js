// Escensus training hub offline service worker.
// Caches the launcher shell + the Script Trainer so the hub opens with no internet.
// The Objection Drill has its own service worker under /drill/.

const CACHE = 'escensus-train-v7'
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './script/',
  './script/index.html',
  './roleplay/',
  './roleplay/index.html',
  '../drill/icon-192.png',
  '../drill/icon-512.png',
]

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function cachePut(req, resp, origin) {
  if (resp && resp.status === 200 && origin === location.origin) {
    const copy = resp.clone()
    caches.open(CACHE).then((c) => c.put(req, copy))
  }
  return resp
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET') return

  const isPage =
    e.request.mode === 'navigate' ||
    url.pathname.endsWith('/') ||
    url.pathname.endsWith('.html')

  if (isPage) {
    // Network-first for pages: always show the freshest build when online,
    // fall back to cache only when offline. Stops stale HTML from sticking.
    e.respondWith(
      fetch(e.request)
        .then((resp) => cachePut(e.request, resp, url.origin))
        .catch(() => caches.match(e.request).then((hit) => hit || caches.match('./index.html'))),
    )
    return
  }

  // Cache-first for static assets (audio, icons, manifest): fast + offline.
  e.respondWith(
    caches.match(e.request).then((hit) => {
      if (hit) return hit
      return fetch(e.request)
        .then((resp) => cachePut(e.request, resp, url.origin))
        .catch(() => undefined)
    }),
  )
})
