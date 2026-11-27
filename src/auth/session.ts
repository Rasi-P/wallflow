import { createStore } from 'zustand/vanilla'
import type { Account, createAuthApi } from './api.ts'

const SESSION_LOST = 'Your session ended. Sign in again to open this wall.'
const VERIFY_FAILED = 'We couldn’t check your session. Check your connection and try again.'
const START_FAILED = 'We couldn’t start Google sign-in. Check your connection and try again.'
const LOGOUT_FAILED = 'Sign-out couldn’t be confirmed. Please try again.'
export const SESSION_RECHECK_MS = 5 * 60_000
const SESSION_RETRY_MS = 30_000

const loginMessages = new Map([
  ['denied', 'Google sign-in was cancelled. You can try again whenever you’re ready.'],
  ['expired', 'This sign-in attempt expired. Please try again.'],
  ['invalid', 'We couldn’t verify your Google sign-in. Please try again.'],
  ['unavailable', 'Google sign-in is temporarily unavailable. Please try again in a moment.'],
  ['csrf', 'This sign-in request expired. Please try again.'],
])

export function loginNotice(search: string) {
  const reason = new URLSearchParams(search).get('login')
  return reason ? loginMessages.get(reason) : undefined
}

export type ActiveSession = {
  status: 'authenticated'
  user: Account
  signingOut: boolean
  logoutError?: string
  recheckError?: string
  verifyingAccountChange?: boolean
}

export type AuthState =
  | { status: 'checking' }
  | { status: 'anonymous'; starting: boolean; notice?: string }
  | ActiveSession
  | { status: 'error'; notice: string }

export function createAuthSession(api: ReturnType<typeof createAuthApi>, submit: (token: string) => void, initialNotice?: string) {
  const store = createStore<AuthState>(() => ({ status: 'checking' }))
  const setState = (state: AuthState) => store.setState(state, true)
  let check: Promise<void> | undefined
  let lastChecked = 0
  let generation = 0
  let returnNotice = initialNotice

  function verify() {
    if (check) return check
    const previous = store.getState()
    if (previous.status === 'authenticated' && previous.signingOut) return Promise.resolve()
    const version = generation
    check = api.currentAccount().then((user) => {
      if (version !== generation) return
      lastChecked = Date.now()
      if (user) setState({
        status: 'authenticated',
        user,
        signingOut: false,
        logoutError: previous.status === 'authenticated' && previous.user.id === user.id ? previous.logoutError : undefined,
      })
      else setState({ status: 'anonymous', starting: false, notice: previous.status === 'authenticated' ? SESSION_LOST : returnNotice })
      returnNotice = undefined
    }).catch(() => {
      if (version !== generation) return
      lastChecked = Date.now()
      if (previous.status === 'authenticated') setState({ ...previous, recheckError: VERIFY_FAILED })
      else setState({ status: 'error', notice: VERIFY_FAILED })
    }).finally(() => { check = undefined })
    return check
  }

  function refresh(maxAge = SESSION_RECHECK_MS) {
    const current = store.getState()
    if (current.status !== 'authenticated') return
    const age = current.recheckError ? Math.min(maxAge, SESSION_RETRY_MS) : maxAge
    if (Date.now() - lastChecked >= age) return verify()
  }

  function verifyOnReturn() {
    const state = store.getState()
    if (state.status === 'authenticated') return verify()
    setState({ status: 'checking' })
    return verify()
  }

  function verifyAfterAccountChange() {
    const state = store.getState()
    if (state.status !== 'authenticated' || state.signingOut) return
    if (state.verifyingAccountChange) return verify()
    generation++
    const pending = check
    setState({ ...state, verifyingAccountChange: true, recheckError: undefined })
    return pending ? pending.then(verify) : verify()
  }

  function retry() {
    if (store.getState().status === 'error') setState({ status: 'checking' })
    return verify()
  }

  async function beginLogin() {
    const state = store.getState()
    if (state.status !== 'anonymous' || state.starting) return
    setState({ status: 'anonymous', starting: true })
    try {
      submit(await api.csrfToken())
    } catch {
      setState({ status: 'anonymous', starting: false, notice: START_FAILED })
    }
  }

  async function signOut() {
    const state = store.getState()
    if (state.status !== 'authenticated' || state.signingOut) return
    generation++
    setState({ ...state, signingOut: true, logoutError: undefined })
    try {
      await api.logout()
      setState({ status: 'anonymous', starting: false })
    } catch {
      setState({ ...state, signingOut: false, logoutError: LOGOUT_FAILED })
      await check
      await verify()
    }
  }

  return { store, verify, refresh, verifyOnReturn, verifyAfterAccountChange, retry, beginLogin, signOut }
}
