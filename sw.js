const CACHE_NAME = 'epub-reader-v1'
const STATIC_ASSETS = [
  './',
  './index.html',
  './reader.html',
  './flashcards.html',
  './highlights.html',
  './theme.css',
  './theme.js',
  './db.js',
  './dropbox.js',
  './sync.js',
  './translate.js',
  './translate-worker.js',
  './manifest.json',
]

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  // Network first for API calls, cache first for static assets
  if (e.request.url.includes('workers.dev') || e.request.url.includes('dropbox')) {
    return // Let network handle API calls
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  )
})
