import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { isCaptureLink } from '../src/pwa/captureLink.ts'
import { nativeAssociations } from '../src/pwa/associations.ts'
import { matchesOfflineSession, offlineSessionProof } from '../src/pwa/offlineIdentity.ts'

const manifest = JSON.parse(readFileSync(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'))
const worker = readFileSync(new URL('../src/pwa/sw.js', import.meta.url), 'utf8')
const origin = 'https://wallflow.example'
const shell = ['/index.html', '/offline.html', '/assets/index-abc.js']
const publicPaths = ['/environments/paper.jpg', '/environments/private.jpg']

function lifecycle() {
  type Event = { request?: Request; data?: unknown; waitUntil(promise: Promise<unknown>): void; respondWith(promise: Promise<Response>): void }
  const events = new Map<string, (event: Event) => void>()
  const storage = new Map<string, Map<string, Response>>()
  const requests: Request[] = []
  let offline = false
  let claims = 0
  let skips = 0

  async function access(name: string) {
    if (!storage.has(name)) storage.set(name, new Map())
    const entries = storage.get(name)!
    return {
      match: async (request: Request) => entries.get(request.url)?.clone(),
      put: async (request: Request, response: Response) => { entries.set(request.url, response) },
    }
  }

  runInNewContext(worker, {
    URL, Request, Response,
    self: {
      location: { origin }, wallflowBuild: { version: 'abc', shell, publicAssets: publicPaths },
      addEventListener: (kind: string, handler: (event: Event) => void) => events.set(kind, handler),
      clients: { claim: async () => { claims++ } }, skipWaiting: async () => { skips++ },
    },
    caches: { open: access, keys: async () => [...storage.keys()], delete: async (name: string) => storage.delete(name) },
    fetch: async (request: Request) => {
      if (offline) throw new TypeError('offline')
      requests.push(request)
      const headers = { 'Cache-Control': request.url.includes('private') ? 'private, no-store' : 'public' }
      const response = new Response(request.url, { headers })
      return Object.defineProperties(response, { type: { value: 'basic' }, url: { value: request.url } })
    },
  })

  function fire(kind: string, initial: Partial<Event> = {}) {
    let result: Promise<unknown> | undefined
    events.get(kind)!({
      ...initial,
      waitUntil: (value) => { result = value },
      respondWith: (value) => { result = value },
    })
    return result as Promise<Response> | undefined
  }
  function request(path: string, init: RequestInit = {}, navigation = false) {
    const req = new Request(new URL(path, origin), init)
    if (navigation) Object.defineProperty(req, 'mode', { value: 'navigate' })
    return fire('fetch', { request: req })
  }
  return { fire, request, storage, requests, connect: (state: boolean) => { offline = !state }, skips: () => skips, claims: () => claims }
}

test('manifest installs a standalone app with real icons, a safe maskable icon and a capture shortcut', () => {
  assert.equal(manifest.name, 'WALLFLOW')
  assert.equal(manifest.display, 'standalone')
  assert.equal(manifest.scope, '/')
  assert.equal(manifest.start_url, '/app/')
  assert.equal(manifest.shortcuts[0].url, '/capture')
  assert.ok(manifest.icons.some(({ purpose }: { purpose: string }) => purpose === 'maskable'))
  for (const icon of manifest.icons) {
    const png = readFileSync(new URL('../public' + icon.src, import.meta.url))
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes)
  }
})

test('worker precaches the release shell and only activates an update after a client request', async () => {
  const sw = lifecycle()
  sw.storage.set('wallflow-shell-old', new Map())
  sw.storage.set('other-app', new Map())
  await sw.fire('install')
  assert.equal(sw.skips(), 0)
  assert.ok(sw.storage.has('wallflow-shell-old'))
  assert.deepEqual(sw.requests.map((req) => new URL(req.url).pathname), shell)
  assert.ok(sw.requests.every((req) => req.credentials === 'omit' && req.redirect === 'error'))
  await sw.fire('message', { data: { type: 'anything-else' } })
  assert.equal(sw.skips(), 0)
  await sw.fire('message', { data: { type: 'WALLFLOW_ACTIVATE_UPDATE' } })
  await sw.fire('activate')
  assert.equal(sw.skips(), 1)
  assert.equal(sw.claims(), 1)
  assert.deepEqual([...sw.storage.keys()], ['other-app', 'wallflow-shell-abc'])
})

test('worker opens declared routes and falls back to a static offline page if the cached shell was evicted', async () => {
  const sw = lifecycle()
  await sw.fire('install')
  sw.connect(false)
  for (const path of ['/', '/app/', '/capture', '/capture/native/android', '/capture/native/ios']) {
    const response = await sw.request(path, {}, true)
    assert.equal(await response?.text(), origin + '/index.html')
  }
  sw.storage.get('wallflow-shell-abc')?.delete(origin + '/index.html')
  assert.equal(await (await sw.request('/app/', {}, true))?.text(), origin + '/offline.html')
  assert.equal(sw.request('/unknown', {}, true), undefined)
})

test('worker excludes callbacks, query strings, private navigation and API traffic from Cache Storage', async () => {
  const sw = lifecycle()
  await sw.fire('install')
  for (const path of ['/auth/callback', '/auth/callback?code=secret', '/auth/native/ios/callback',
    '/auth/native/android/callback?code=secret', '/app/?access_token=example', '/rest/v1/workspaces', '/capture?code=secret']) {
    assert.equal(sw.request(path, {}, true), undefined)
  }
  for (const [path, headers] of [
    ['https://supabase.example/rest/v1/rpc/read_wallflow_workspace', {}],
    ['/assets/index-abc.js', { Authorization: 'Bearer private' }],
    ['/environments/paper.jpg?token=private', {}],
    ['/api/user', {}],
  ] as [string, HeadersInit][]) assert.equal(sw.request(path, { headers }), undefined)
  assert.equal(sw.request('/assets/index-abc.js', { method: 'POST' }), undefined)
  await sw.request('/environments/private.jpg')
  const cached = sw.storage.get('wallflow-shell-abc')!
  assert.equal(cached.has(origin + '/environments/private.jpg'), false)
  await sw.request('/environments/paper.jpg', { headers: { Cookie: 'private=value' } })
  const assetFetch = sw.requests.at(-1)!
  assert.equal(assetFetch.headers.has('Cookie'), false)
  assert.equal(assetFetch.credentials, 'omit')
  assert.equal(cached.has(origin + '/environments/paper.jpg'), true)
})

test('capture links accept only known paths and no account or credential parameters', () => {
  for (const path of ['/capture', '/capture/native/android', '/capture/native/ios']) {
    assert.equal(isCaptureLink(new URL(path, origin)), true)
    for (const suffix of ['?board=123', '?code=abc', '#access_token=abc', '/']) {
      assert.equal(isCaptureLink(new URL(path + suffix, origin)), false)
    }
  }
  assert.equal(isCaptureLink(new URL('/auth/callback?code=abc', origin)), false)
})

test('offline proof is scoped to the exact previously verified unexpired session', async () => {
  const session = { user: { id: 'owner-1' }, access_token: 'fixture-token', expires_at: 20 }
  const proof = await offlineSessionProof(session, 1000)
  assert.ok(proof)
  assert.equal(proof.proof.includes('fixture-token'), false)
  assert.equal(matchesOfflineSession(JSON.stringify(proof), await offlineSessionProof(session, 1000)), true)
  assert.equal(matchesOfflineSession(JSON.stringify(proof), await offlineSessionProof({ ...session, user: { id: 'owner-2' } }, 1000)), false)
  assert.equal(matchesOfflineSession(JSON.stringify(proof), await offlineSessionProof({ ...session, access_token: 'other-token' }, 1000)), false)
  assert.equal(matchesOfflineSession(JSON.stringify(proof), await offlineSessionProof(session, 20_000)), false)
  assert.equal(matchesOfflineSession(null, proof), false)
})

test('association files bind only configured app IDs and verified signing fingerprints', () => {
  const fingerprint = Array(32).fill('ab').join(':')
  const unconfigured = nativeAssociations({})
  assert.deepEqual(unconfigured, { 'apple-app-site-association': { applinks: { details: [] } }, 'assetlinks.json': [] })
  const configured = nativeAssociations({
    WALLFLOW_IOS_TEAM_ID: '1234567890', WALLFLOW_IOS_BUNDLE_ID: 'com.wallflow.capture',
    WALLFLOW_ANDROID_APPLICATION_ID: 'com.wallflow.capture', WALLFLOW_ANDROID_SHA256_FINGERPRINTS: fingerprint,
  })
  assert.deepEqual(configured['apple-app-site-association'].applinks.details[0].appIDs, ['1234567890.com.wallflow.capture'])
  assert.deepEqual(configured['assetlinks.json'][0].target.sha256_cert_fingerprints, [fingerprint.toUpperCase()])
  assert.throws(() => nativeAssociations({ WALLFLOW_IOS_TEAM_ID: '1234567890' }), /Apple team/)
  assert.throws(() => nativeAssociations({ WALLFLOW_ANDROID_APPLICATION_ID: 'com.wallflow.capture' }), /Android application/)
})
