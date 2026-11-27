import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))

test('Vercel serves only the declared SPA routes with internal rewrites', () => {
  assert.deepEqual(config.rewrites, ['/', '/sign-in', '/auth/callback', '/app', '/app/']
    .map((source) => ({ source, destination: '/index.html' })))
  for (const key of ['routes', 'redirects', 'transforms', 'trailingSlash', 'cleanUrls']) {
    assert.equal(Object.hasOwn(config, key), false)
  }
})

test('Vercel sets OAuth callback privacy headers', () => {
  assert.deepEqual(config.headers, [{
    source: '/auth/callback',
    headers: [
      { key: 'Cache-Control', value: 'no-store' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
    ],
  }])
})
