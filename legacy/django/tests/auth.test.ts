import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAuthApi, GOOGLE_START, submitGoogleLogin } from '../src/auth/api.ts'
import { createAuthSession, loginNotice } from '../src/auth/session.ts'

const BASE = '/api/v1/auth'
const user = { id: 'test-account-id', displayName: 'Asha', email: null }
const json = (body: unknown, status = 200) => Response.json(body, { status })
const csrf = (token = 'masked-token') => json({ csrfToken: token })
const responseError = (code: string, status: number) => json({ error: { code } }, status)

function mockApi(...outputs: Array<() => Response | Promise<Response>>) {
  const calls: Array<{ url: string; options: RequestInit }> = []
  const fetcher: typeof fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options })
    const next = outputs.shift()
    assert.ok(next, `Unexpected request to ${url}`)
    return next()
  }
  return { api: createAuthApi(fetcher), calls }
}

test('unauthenticated startup waits for the backend and treats 401 and 403 as signed out', async () => {
  for (const status of [401, 403]) {
    const pending = Promise.withResolvers<Response>()
    const { api, calls } = mockApi(() => pending.promise)
    const auth = createAuthSession(api, () => assert.fail('Unexpected sign-in'))
    assert.deepEqual(auth.store.getState(), { status: 'checking' })

    const check = auth.verify()
    assert.equal(auth.store.getState().status, 'checking')
    assert.equal(calls[0].url, `${BASE}/me/`)
    pending.resolve(responseError('auth_required', status))
    await check
    assert.equal(auth.store.getState().status, 'anonymous')
  }
})

test('authenticated startup coalesces simultaneous session checks and avoids a redundant refresh', async () => {
  const pending = Promise.withResolvers<Response>()
  const { api, calls } = mockApi(() => pending.promise)
  const auth = createAuthSession(api, () => {})
  const first = auth.verify()
  assert.equal(auth.verify(), first)
  assert.equal(calls.length, 1)
  pending.resolve(json(user))
  await first
  assert.deepEqual(auth.store.getState(), { status: 'authenticated', user, signingOut: false, logoutError: undefined })
  await auth.refresh()
  assert.equal(calls.length, 1)
  assert.equal(calls[0].options.credentials, 'same-origin')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.redirect, 'error')
})

test('Google sign-in uses a fresh masked token and ignores repeated clicks in flight', async () => {
  const token = Promise.withResolvers<Response>()
  const { api, calls } = mockApi(() => responseError('auth_required', 403), () => token.promise)
  const submitted: string[] = []
  const auth = createAuthSession(api, (value) => { submitted.push(value) })
  await auth.verify()
  const starting = auth.beginLogin()
  await auth.beginLogin()
  assert.deepEqual(auth.store.getState(), { status: 'anonymous', starting: true })
  assert.deepEqual(calls.map(({ url }) => url), [`${BASE}/me/`, `${BASE}/csrf/`])
  assert.equal(calls[1].options.credentials, 'same-origin')
  token.resolve(csrf())
  await starting
  assert.deepEqual(submitted, ['masked-token'])
})

test('Google start submits a top-level form to the Django start endpoint with its CSRF field', () => {
  const input = { name: '', value: '', type: '' }
  const actions: string[] = []
  const form = {
    method: '',
    action: '',
    append(child: typeof input) { assert.equal(child, input) },
    submit() { actions.push('submitted') },
    remove() { actions.push('removed') },
  }
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string) { return tag === 'form' ? form : input },
      body: { append(node: typeof form) { assert.equal(node, form); actions.push('attached') } },
    },
  })
  try {
    submitGoogleLogin('masked-token')
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }

  assert.equal(form.method, 'POST')
  assert.equal(form.action, GOOGLE_START)
  assert.equal(GOOGLE_START, `${BASE}/google/start/`)
  assert.deepEqual(input, { name: 'csrfmiddlewaretoken', value: 'masked-token', type: 'hidden' })
  assert.deepEqual(actions, ['attached', 'submitted', 'removed'])
})

test('callback reasons are allowlisted and a failed login token request permits retry', async () => {
  const { api } = mockApi(() => responseError('auth_required', 403), () => {
    throw new TypeError('network unavailable')
  }, () => csrf('retry-token'))
  const submitted: string[] = []
  const auth = createAuthSession(api, (value) => { submitted.push(value) }, loginNotice('?login=denied'))
  await auth.verify()
  assert.match((auth.store.getState() as { notice: string }).notice, /cancelled/)
  assert.match(loginNotice('?login=expired') ?? '', /expired/)
  assert.match(loginNotice('?login=invalid') ?? '', /verify/)
  assert.match(loginNotice('?login=unavailable') ?? '', /unavailable/)
  assert.match(loginNotice('?login=csrf') ?? '', /expired/)
  assert.equal(loginNotice('?login=<script>'), undefined)
  await auth.beginLogin()
  assert.match((auth.store.getState() as { notice: string }).notice, /couldn’t start/)
  await auth.beginLogin()
  assert.deepEqual(submitted, ['retry-token'])
})

test('network and unexpected session responses fail closed and support retry', async () => {
  const { api } = mockApi(
    () => { throw new TypeError('disconnected') },
    () => json({ id: 'only-a-partial-account' }),
    () => json(user),
  )
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  assert.equal(auth.store.getState().status, 'error')
  await auth.retry()
  assert.equal(auth.store.getState().status, 'error')
  await auth.retry()
  assert.equal(auth.store.getState().status, 'authenticated')
})

test('expiry on revalidation closes the workspace and offers sign-in again', async () => {
  const { api } = mockApi(() => json(user), () => responseError('auth_required', 403))
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  await auth.refresh(0)
  assert.deepEqual(auth.store.getState(), {
    status: 'anonymous', starting: false, notice: 'Your session ended. Sign in again to open this wall.',
  })
})

test('logout uses a fresh CSRF header and retries one rejected token', async () => {
  const { api, calls } = mockApi(
    () => json(user),
    () => csrf('first-csrf'),
    () => responseError('csrf_failed', 403),
    () => csrf('next-csrf'),
    () => new Response(null, { status: 204 }),
  )
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  await auth.signOut()
  assert.equal(auth.store.getState().status, 'anonymous')
  for (const [index, token] of [[2, 'first-csrf'], [4, 'next-csrf']] as const) {
    assert.equal(calls[index].url, `${BASE}/logout/`)
    assert.equal(calls[index].options.method, 'POST')
    assert.equal(calls[index].options.credentials, 'same-origin')
    assert.equal(new Headers(calls[index].options.headers).get('X-CSRFToken'), token)
  }
})

test('failed logout verifies the session again before keeping the wall open', async () => {
  const { api } = mockApi(
    () => json(user),
    () => csrf(),
    () => { throw new TypeError('Connection reset') },
    () => json(user),
    () => csrf(),
    () => responseError('auth_required', 403),
  )
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  await auth.signOut()
  const state = auth.store.getState()
  assert.equal(state.status, 'authenticated')
  assert.ok(state.status === 'authenticated' && state.logoutError)
  await auth.signOut()
  assert.deepEqual(auth.store.getState(), { status: 'anonymous', starting: false })
})

test('a stale in-flight session check cannot reopen the wall after logout', async () => {
  const oldCheck = Promise.withResolvers<Response>()
  const { api } = mockApi(
    () => json(user), () => oldCheck.promise, () => csrf(), () => new Response(null, { status: 204 }),
  )
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  const refresh = auth.refresh(0)
  await auth.signOut()
  oldCheck.resolve(json(user))
  await refresh
  assert.deepEqual(auth.store.getState(), { status: 'anonymous', starting: false })
})

test('login initialization and logout never access or alter the saved local wall', async (t) => {
  const legacyKey = 'wallflow-wall-v1'
  const saved = '{"version":1,"state":{"notes":[{"title":"Keep my wall"}],"onboardingComplete":true}}'
  const stored = new Map([[legacyKey, saved]])
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => assert.fail('Authentication must not access browser storage'),
  })
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  })
  const { api, calls } = mockApi(
    () => responseError('auth_required', 403), () => csrf('start'), () => json(user),
    () => csrf('stop'), () => new Response(null, { status: 204 }),
  )
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  await auth.beginLogin()
  await auth.verifyOnReturn()
  await auth.signOut()
  assert.equal(stored.get(legacyKey), saved)
  assert.ok(calls.every(({ url }) => url.startsWith(`${BASE}/`)))
})

test('a cross-tab account change protects the current session pending server proof and ignores an older verification', async () => {
  const replacement = { id: 'replacement-account', displayName: 'Replacement', email: null }
  const stale = Promise.withResolvers<Response>()
  const next = Promise.withResolvers<Response>()
  const { api, calls } = mockApi(() => json(user), () => stale.promise, () => next.promise)
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  const earlier = auth.verify()
  const refresh = auth.verifyAfterAccountChange()
  assert.deepEqual(auth.store.getState(), {
    status: 'authenticated', user, signingOut: false, verifyingAccountChange: true,
    logoutError: undefined, recheckError: undefined,
  })
  stale.resolve(json(user))
  await earlier
  const pending = auth.store.getState()
  assert.ok(pending.status === 'authenticated' && pending.verifyingAccountChange)
  assert.equal(pending.user.id, user.id)
  assert.equal(calls.length, 3)
  next.resolve(json(replacement))
  await refresh
  const session = auth.store.getState()
  assert.equal(session.status, 'authenticated')
  if (session.status === 'authenticated') assert.equal(session.user.id, replacement.id)
})

test('a 503, network failure, and generic proxy 403 preserve the authenticated workspace until retry succeeds', async () => {
  const { api } = mockApi(
    () => json(user),
    () => responseError('unavailable', 503),
    () => { throw new TypeError('network unreachable') },
    () => new Response('Gateway error', { status: 403 }),
    () => json(user),
  )
  const auth = createAuthSession(api, () => {})
  const seen = new Set<string>()
  auth.store.subscribe((state) => seen.add(state.status))
  await auth.verify()
  for (let attempt = 0; attempt < 3; attempt++) {
    await auth.retry()
    const state = auth.store.getState()
    assert.ok(state.status === 'authenticated' && state.recheckError)
    assert.equal(state.user.id, user.id)
    assert.equal(state.verifyingAccountChange, undefined)
  }
  await auth.retry()
  assert.deepEqual([...seen], ['authenticated'])
  assert.deepEqual(auth.store.getState(), { status: 'authenticated', user, signingOut: false, logoutError: undefined })
})

test('a cross-tab signal followed by a failed verification keeps the current session until verified', async () => {
  const { api } = mockApi(() => json(user), () => responseError('unavailable', 503), () => json(user), () => responseError('auth_required', 403))
  const auth = createAuthSession(api, () => {})
  await auth.verify()
  await auth.verifyAfterAccountChange()
  const concealed = auth.store.getState()
  assert.ok(concealed.status === 'authenticated' && concealed.verifyingAccountChange && concealed.recheckError)
  assert.equal(concealed.user.id, user.id)
  await auth.retry()
  const recovered = auth.store.getState()
  assert.ok(recovered.status === 'authenticated' && !recovered.verifyingAccountChange && !recovered.recheckError)
  await auth.verifyAfterAccountChange()
  assert.equal(auth.store.getState().status, 'anonymous')
})
