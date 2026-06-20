// Service Worker — lluvia-alert
// Estrategia: cache-first para assets estáticos, network-first para APIs
const CACHE_NAME = 'lluvia-alert-v1'

const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
]

// ─── Install: pre-cachear assets críticos ────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  )
  self.skipWaiting()
})

// ─── Activate: limpiar caches viejos ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    )
  )
  self.clients.claim()
})

// ─── Fetch: estrategia por tipo de request ────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)

  // APIs externas → network-first, sin cache (datos en tiempo real)
  if (
    url.hostname === 'api.rainviewer.com' ||
    url.hostname === 'api.open-meteo.com' ||
    url.hostname === 'tilecache.rainviewer.com' ||
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname === 'unpkg.com'
  ) {
    event.respondWith(fetch(request).catch(() => new Response('', { status: 503 })))
    return
  }

  // Assets propios → cache-first con fallback a network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request).then((response) => {
        // Solo cachear responses exitosas de mismo origen
        if (response.ok && url.origin === self.location.origin) {
          const clone = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone))
        }
        return response
      })
    })
  )
})
