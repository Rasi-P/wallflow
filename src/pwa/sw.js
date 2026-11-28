const { version, shell, publicAssets } = self.wallflowBuild
const prefix = 'wallflow-shell-'
const cacheName = prefix + version
const shellPaths = new Set(shell)
const runtimePaths = new Set(publicAssets)
const routes = new Set(['/', '/index.html', '/sign-in', '/app', '/app/', '/capture', '/capture/native/android', '/capture/native/ios'])

function publicRequest(path) {
  return new Request(new URL(path, self.location.origin), {
    credentials: 'omit', redirect: 'error', cache: 'reload', referrerPolicy: 'no-referrer',
  })
}

async function publicResponse(path) {
  const request = publicRequest(path)
  const response = await fetch(request)
  const policy = response.headers.get('Cache-Control') ?? ''
  if (!response.ok || response.status !== 200 || response.type !== 'basic'
    || response.url !== request.url || /\b(private|no-store)\b/i.test(policy)) {
    throw new Error('Invalid public application asset')
  }
  return response
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName)
    await Promise.all(shell.map(async (path) => cache.put(publicRequest(path), await publicResponse(path))))
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((key) => key.startsWith(prefix) && key !== cacheName).map((key) => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('message', (event) => {
  if (event.data?.type === 'WALLFLOW_ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting())
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search || url.hash
    || request.headers.has('Authorization') || request.headers.has('Range')) return

  if (request.mode === 'navigate') {
    if (!routes.has(url.pathname)) return
    event.respondWith((async () => {
      const cache = await caches.open(cacheName)
      return await cache.match(publicRequest('/index.html'))
        ?? await fetch(request).catch(async () => await cache.match(publicRequest('/offline.html')) ?? Response.error())
    })())
    return
  }

  const path = url.pathname
  if (path === '/index.html' || path === '/offline.html' || (!shellPaths.has(path) && !runtimePaths.has(path))) return
  event.respondWith((async () => {
    const cache = await caches.open(cacheName)
    const key = publicRequest(path)
    const hit = await cache.match(key)
    if (hit) return hit
    const response = await publicResponse(path).catch(() => undefined)
    if (!response) return fetch(request)
    try { await cache.put(key, response.clone()) } catch { /* Quota errors can leave the public asset uncached. */ }
    return response
  })())
})
