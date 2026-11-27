import assert from 'node:assert/strict'
import { setImmediate, setTimeout } from 'node:timers/promises'
import test from 'node:test'
import { createSupabaseAuthApi } from '../src/auth/supabaseAuth.ts'
import { createWallflowSupabaseClient } from '../src/auth/supabaseClient.ts'
import { createSupabaseSession } from '../src/auth/supabaseSession.ts'
import { SupabaseWorkspaceDenied } from '../src/auth/supabaseWorkspace.ts'

const origins = ['http://localhost:5173', 'https://wallflow-staging.example.invalid']

function fixture(path = '/', ownerId: string | null = 'owner-a', origin = origins[0]) {
  let location: URL = new URL(path, origin)
  let listener: Parameters<ReturnType<typeof createSupabaseAuthApi>['subscribe']>[0] | undefined
  const exchanges: string[] = []
  const opened: string[] = []
  const redirects: string[] = []
  const workspaceFor = (owner: string) => ({
    id: `${owner}-workspace`, revision: '0', activeBoardId: `${owner}-board`,
    boards: [{ id: `${owner}-board`, name: 'Wall', notes: [] }],
  })
  const auth: ReturnType<typeof createSupabaseAuthApi> = {
    async signInWithGoogle(redirectTo) { redirects.push(redirectTo) },
    async exchangeCode(code) { exchanges.push(code); return 'owner-a' },
    async currentAccount() { return ownerId ? { id: ownerId, displayName: null, email: null } : null },
    async signOut() { ownerId = null },
    subscribe(onChange) {
      listener = onChange
      return () => { listener = undefined }
    },
  }
  const workspace = {
    async open(owner: string, _signal: AbortSignal) {
      opened.push(owner)
      return workspaceFor(owner)
    },
  }
  const session = createSupabaseSession(auth, workspace, {
    currentUrl: () => location.href,
    replacePath: (next) => { location = new URL(next, origin) },
  })
  return {
    session, auth, workspace, workspaceFor, exchanges, opened, redirects,
    path: () => location.pathname + location.search + location.hash,
    accountChange(event: Parameters<NonNullable<typeof listener>>[0], owner: string | null) {
      ownerId = owner
      listener?.(event, owner)
    },
  }
}

test('a PKCE callback is consumed once, scrubbed, and checked against the verified account', async (t) => {
  for (const origin of origins) {
    const app = fixture('/auth/callback?code=test-code&next=https://unexpected.example', 'owner-a', origin)
    const firstMount = app.session.connect()
    firstMount()
    t.after(app.session.connect())
    await setImmediate()
    assert.deepEqual(app.exchanges, ['test-code'])
    assert.deepEqual(app.opened, ['owner-a'])
    assert.equal(app.session.store.getState().status, 'ready')
    assert.equal(app.path(), '/app/')
  }
})

test('Google cancellation and invalid callback URLs are scrubbed without opening a cached workspace', async (t) => {
  for (const path of [
    '/auth/callback?error=access_denied&error_description=provider-detail',
    '/auth/callback#error=access_denied&error_description=provider-detail',
    '/auth/callback?code=one&code=two',
    '/auth/callback?code=one&error_code=unexpected',
    '/auth/callback#access_token=untrusted',
  ]) {
    const app = fixture(path)
    const stop = app.session.connect()
    t.after(stop)
    await setImmediate()
    const state = app.session.store.getState()
    assert.equal(state.status, 'anonymous')
    if (state.status === 'anonymous') {
      assert.match(state.notice ?? '', path.includes('access_denied') ? /cancelled/ : /could not be completed/)
      assert.doesNotMatch(state.notice ?? '', /provider-detail|untrusted/)
    }
    assert.deepEqual(app.exchanges, [])
    assert.deepEqual(app.opened, [])
    assert.equal(app.path(), '/sign-in')
  }
})

test('a failed exchange and a callback session for the wrong account fail closed', async (t) => {
  const wrongAccount = fixture('/auth/callback?code=valid-format', 'owner-b')
  const failed = fixture('/auth/callback?code=valid-format')
  failed.auth.exchangeCode = async () => { throw new Error('raw provider response') }
  for (const app of [wrongAccount, failed]) {
    t.after(app.session.connect())
    await setImmediate()
    assert.equal(app.session.store.getState().status, 'anonymous')
    assert.deepEqual(app.opened, [])
    assert.equal(app.path(), '/sign-in')
  }
})

test('explicit Google sign-in uses a fixed app callback and ignores a repeated click', async (t) => {
  for (const origin of origins) {
    const app = fixture('/sign-in?next=https://unexpected.example', null, origin)
    t.after(app.session.connect())
    await setImmediate()
    await Promise.all([app.session.signIn(), app.session.signIn()])
    assert.deepEqual(app.redirects, [origin + '/auth/callback'])
    app.session.resume()
    assert.equal(app.session.store.getState().status, 'anonymous')
    await app.session.signIn()
    assert.equal(app.redirects.length, 2)
  }
})

test('the Google adapter asks the provider to show the account chooser', async (t) => {
  const client = createWallflowSupabaseClient({
    VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_fixture',
  })
  const redirectTo = 'http://localhost:5173/auth/callback'
  const signIn = t.mock.method(client.auth, 'signInWithOAuth', async () => ({ data: { provider: 'google', url: null }, error: null }))
  await createSupabaseAuthApi(client).signInWithGoogle(redirectTo)
  assert.deepEqual(signIn.mock.calls[0].arguments, [{ provider: 'google', options: { redirectTo, queryParams: { prompt: 'select_account' } } }])
})

test('account changes conceal the previous workspace and discard an in-flight read', async (t) => {
  const app = fixture()
  let finishOldRead: () => void = () => assert.fail('Old read did not start')
  let first = true
  app.workspace.open = async (owner) => {
    if (first) {
      first = false
      await new Promise<void>((resolve) => { finishOldRead = resolve })
    }
    return app.workspaceFor(owner)
  }
  t.after(app.session.connect())
  await setImmediate()
  app.accountChange('SIGNED_IN', 'owner-b')
  assert.equal(app.session.store.getState().status, 'checking')
  const seen: string[] = []
  t.after(app.session.store.subscribe((state) => { if (state.status === 'ready') seen.push(state.account.id) }))
  finishOldRead()
  await setTimeout(10)
  assert.deepEqual(seen, ['owner-b'])
})

test('refresh revalidates access, expiry closes the workspace, and logout clears it', async (t) => {
  const app = fixture()
  t.after(app.session.connect())
  await setImmediate()
  app.accountChange('TOKEN_REFRESHED', 'owner-a')
  await setTimeout(10)
  assert.deepEqual(app.opened, ['owner-a', 'owner-a'])
  app.accountChange('SIGNED_OUT', null)
  assert.equal(app.session.store.getState().status, 'anonymous')
  app.accountChange('SIGNED_IN', 'owner-b')
  await setTimeout(10)
  assert.equal(app.session.store.getState().status, 'ready')
  await app.session.signOut()
  assert.equal(app.session.store.getState().status, 'anonymous')
  assert.equal(app.path(), '/sign-in')
})

test('an authenticated but disabled account cannot see a workspace', async (t) => {
  const app = fixture()
  app.workspace.open = async () => { throw new SupabaseWorkspaceDenied() }
  t.after(app.session.connect())
  await setImmediate()
  assert.equal(app.session.store.getState().status, 'blocked')
  await app.session.signOut()
  assert.equal(app.session.store.getState().status, 'anonymous')
})
