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


test('the public Android association binds the WALLFLOW package to its debug signing certificate', () => {
  const associationPath = '/.well-known/assetlinks.json'
  const association = JSON.parse(readFileSync(new URL('../public' + associationPath, import.meta.url), 'utf8'))
  assert.deepEqual(association, [{
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.wallflow.capture',
      sha256_cert_fingerprints: [
        '1C:F2:A1:05:4F:4E:1D:C6:5B:13:5D:E1:3E:F9:35:4D:87:B6:1C:FF:23:7B:CA:4D:61:EE:D5:80:51:43:40:45',
      ],
    },
  }])
  assert.ok(config.rewrites.every(({ source }: { source: string }) => source !== associationPath))
})

test('the Android verified HTTPS filter and Vercel agree on the capture and callback paths', () => {
  const manifest = readFileSync(new URL('../native/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
  const filter = manifest.match(/<intent-filter android:autoVerify="true">([\s\S]*?)<\/intent-filter>/)?.[1]
  assert.ok(filter)
  assert.match(filter, /android.intent.action.VIEW/)
  assert.match(filter, /android.intent.category.DEFAULT/)
  assert.match(filter, /android.intent.category.BROWSABLE/)
  const links = [...filter.matchAll(/<data android:scheme="https" android:host="\$\{wallflowHost\}" android:path="([^"]+)" \/>/g)]
    .map((match) => match[1])
  assert.deepEqual(links, ['/capture/native/android', '/auth/native/android/callback'])
  assert.ok(config.rewrites.some(({ source, destination }: { source: string; destination: string }) =>
    source === links[1] && destination === '/native-auth.html'))
})
