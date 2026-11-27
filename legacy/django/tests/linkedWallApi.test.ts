import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createLinkedWallApi, LinkedWallError } from '../src/auth/linkedWallApi.ts'

const account = 'account-a'

function client(response: Response) {
  const fetcher: typeof fetch = async (url, options) => {
    assert.equal(url, '/api/v1/workspace/')
    assert.equal(new Headers(options?.headers).get('X-Wallflow-Account'), account)
    return response
  }
  return createLinkedWallApi(account, new AbortController().signal, fetcher)
}

test('authenticated workspace errors cannot fall back to local data', async () => {
  const error = { error: { code: 'board_not_linked' } }
  await assert.rejects(client(Response.json(error, { status: 404 })).read(),
    (failure) => failure instanceof LinkedWallError && failure.status === 404)
  await assert.rejects(client(Response.json(error, { status: 503 })).read(),
    (failure) => failure instanceof LinkedWallError && failure.status === 503)
  await assert.rejects(client(new Response('No API route', { status: 404 })).read(),
    (failure) => failure instanceof LinkedWallError && failure.status === 404)
  await assert.rejects(client(new Response('<html>fallback app</html>')).read(), /Unsupported account workspace/)
  await assert.rejects(client(Response.json(null)).read(), /Unsupported account workspace/)
})

test('only a conditional read can accept an unchanged cloud response', async () => {
  assert.equal(await client(new Response(null, { status: 304 })).read('4'), undefined)
  await assert.rejects(client(new Response(null, { status: 304 })).read())
  await assert.rejects(client(new Response('not JSON')).read('4'), /Unsupported account workspace/)
})
