import assert from 'node:assert/strict'
import test from 'node:test'
import { createWallflowSupabaseClient, getSupabaseClient } from '../src/auth/supabaseClient.ts'

const environment = {
  VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture',
}

test('Supabase client initializes for a configured project and prepares a Google PKCE redirect', async () => {
  const redirectTo = 'http://localhost:5173/auth/callback'
  for (const VITE_SUPABASE_URL of [environment.VITE_SUPABASE_URL, 'https://wallflow.example.invalid/']) {
    const client = createWallflowSupabaseClient({ ...environment, VITE_SUPABASE_URL })
    assert.equal(typeof client.from, 'function')
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, skipBrowserRedirect: true },
    })
    assert.equal(error, null)
    assert.ok(data.url)
    const redirect = new URL(data.url)
    assert.equal(redirect.origin, new URL(VITE_SUPABASE_URL).origin)
    assert.equal(redirect.pathname, '/auth/v1/authorize')
    assert.equal(redirect.searchParams.get('provider'), 'google')
    assert.equal(redirect.searchParams.get('redirect_to'), redirectTo)
    assert.equal(redirect.searchParams.get('code_challenge_method'), 's256')
    assert.ok(redirect.searchParams.get('code_challenge'))
  }
})

test('optional configuration is checked on use and missing values fail clearly', () => {
  const message = /Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY/
  assert.throws(() => getSupabaseClient(), message)
  assert.throws(() => createWallflowSupabaseClient({ VITE_SUPABASE_URL: environment.VITE_SUPABASE_URL }), message)
  assert.throws(() => createWallflowSupabaseClient({ VITE_SUPABASE_PUBLISHABLE_KEY: environment.VITE_SUPABASE_PUBLISHABLE_KEY }), message)
  assert.throws(() => createWallflowSupabaseClient({ ...environment, VITE_SUPABASE_URL: ' ' }), message)
})

test('invalid project origins and non-publishable keys fail without echoing their values', () => {
  for (const url of ['invalid', 'http://wallflow.example.invalid', 'https://wallflow.example.invalid/rest/v1']) {
    assert.throws(() => createWallflowSupabaseClient({ ...environment, VITE_SUPABASE_URL: url }), /VITE_SUPABASE_URL/)
  }
  for (const fixture of ['sb_secret_fixture', 'legacy.jwt.fixture']) {
    assert.throws(() => createWallflowSupabaseClient({ ...environment, VITE_SUPABASE_PUBLISHABLE_KEY: fixture }), (error: unknown) => {
      return error instanceof Error && /must contain a Supabase publishable key/.test(error.message) && !error.message.includes(fixture)
    })
  }
})
