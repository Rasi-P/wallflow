import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
const paths = ['/auth/callback', '/auth/native/android/callback', '/auth/native/ios/callback']

test('Vercel uses the ordinary production build', () => {
  assert.equal(config.framework, 'vite')
  assert.equal(config.buildCommand, 'npm run build')
  assert.equal(config.outputDirectory, 'dist')
})

test('Vercel serves only the declared SPA and native callback routes', () => {
  assert.deepEqual(config.rewrites, [
    ...['/', '/sign-in', '/auth/callback', '/app', '/app/', '/capture', '/capture/native/android', '/capture/native/ios']
      .map((source) => ({ source, destination: '/index.html' })),
    ...paths.slice(1).map((source) => ({ source, destination: '/native-auth.html' })),
  ])
  for (const key of ['routes', 'redirects', 'transforms', 'trailingSlash', 'cleanUrls']) {
    assert.equal(Object.hasOwn(config, key), false)
  }
})

test('Vercel sets OAuth, worker and platform association headers', () => {
  for (const path of paths) assert.deepEqual(config.headers.find(({ source }: { source: string }) => source === path).headers, [
    { key: 'Cache-Control', value: 'no-store' },
    { key: 'Referrer-Policy', value: 'no-referrer' },
  ])
  for (const path of ['/.well-known/assetlinks.json', '/.well-known/apple-app-site-association']) {
    assert.deepEqual(config.headers.find(({ source }: { source: string }) => source === path).headers, [
      { key: 'Content-Type', value: 'application/json' },
    ])
  }
  assert.match(config.headers.find(({ source }: { source: string }) => source === '/sw.js').headers[0].value, /no-cache/)
})
