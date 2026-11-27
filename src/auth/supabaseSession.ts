import { createStore } from 'zustand/vanilla'
import type { Account } from './api.ts'
import type { AuthState } from './session.ts'
import type { createSupabaseAuthApi } from './supabaseAuth.ts'
import { SupabaseWorkspaceDenied } from './supabaseWorkspace.ts'
import type { createSupabaseWorkspaceApi, WorkspacePreview } from './supabaseWorkspace.ts'

const callbackPath = '/auth/callback'
const callbackFailed = 'Google sign-in could not be completed. Start a new sign-in to try again.'
const sessionEnded = 'Your session ended. Sign in again to open your workspace.'
const workspaceDenied = 'This account or session cannot open the Supabase preview.'

type Navigation = {
  currentUrl: () => string
  replacePath: (path: string) => void
}

type PreviewSession =
  | Exclude<AuthState, { status: 'authenticated' }>
  | { status: 'ready'; account: Account; workspace: WorkspacePreview }
  | { status: 'blocked'; notice: string }

async function completeGoogleCallback(auth: Pick<ReturnType<typeof createSupabaseAuthApi>, 'exchangeCode'>, navigation: Navigation) {
  const url = new URL(navigation.currentUrl())
  if (url.pathname !== callbackPath) return {}

  navigation.replacePath('/sign-in')
  const fragment = new URLSearchParams(url.hash.slice(1))
  const errors = [...url.searchParams.getAll('error'), ...fragment.getAll('error')]
  const codes = url.searchParams.getAll('code')
  if (errors.length === 1 && errors[0] === 'access_denied' && codes.length === 0) {
    return { notice: 'Google sign-in was cancelled.' }
  }
  if (errors.length || url.hash || url.searchParams.has('error_code') || url.searchParams.has('error_description')
    || codes.length !== 1 || !/^[^\s\u0000-\u001f\u007f]{1,2048}$/.test(codes[0])) {
    return { notice: callbackFailed }
  }
  try {
    return { ownerId: await auth.exchangeCode(codes[0]) }
  } catch {
    return { notice: callbackFailed }
  }
}

export function createSupabasePreviewSession(
  auth: ReturnType<typeof createSupabaseAuthApi>,
  workspace: ReturnType<typeof createSupabaseWorkspaceApi>,
  navigation: Navigation,
) {
  const store = createStore<PreviewSession>(() => ({ status: 'checking' }))
  const update = (state: PreviewSession) => store.setState(state, true)
  let startup: ReturnType<typeof completeGoogleCallback> | undefined
  let connected = false
  let automaticChecks = false
  let callbackOwnerId: string | undefined
  let sessionOwnerId: string | null = null
  let signingOut = false
  let pending: AbortController | undefined
  let eventTimer: ReturnType<typeof setTimeout> | undefined

  function cancelChecks() {
    pending?.abort()
    pending = undefined
    clearTimeout(eventTimer)
  }

  async function verify() {
    if (!connected || signingOut || pending) return
    automaticChecks = true
    const request = new AbortController()
    pending = request
    const previous = store.getState()
    const expectedOwnerId = callbackOwnerId
    try {
      const account = await auth.currentAccount()
      if (request.signal.aborted) return
      sessionOwnerId = account?.id ?? null
      if (!account || (expectedOwnerId && account.id !== expectedOwnerId)) {
        update({
          status: 'anonymous', starting: false,
          notice: expectedOwnerId ? callbackFailed : previous.status === 'ready' ? sessionEnded : undefined,
        })
        if (expectedOwnerId) {
          automaticChecks = false
          callbackOwnerId = undefined
        }
        return
      }
      if (previous.status !== 'ready' || previous.account.id !== account.id) update({ status: 'checking' })
      const preview = await workspace.open(account.id, request.signal)
      if (request.signal.aborted) return
      if (expectedOwnerId) {
        callbackOwnerId = undefined
        navigation.replacePath('/app/')
      }
      update({ status: 'ready', account, workspace: preview })
    } catch (error) {
      if (request.signal.aborted) return
      if (!(error instanceof SupabaseWorkspaceDenied) && previous.status === 'ready' && sessionOwnerId === previous.account.id) {
        // A verified, mounted editor can keep its drafts during a transport outage.
        return
      }
      update(error instanceof SupabaseWorkspaceDenied
        ? { status: 'blocked', notice: workspaceDenied }
        : { status: 'error', notice: 'Couldn’t verify your Supabase workspace. Check your connection and retry.' })
    } finally {
      if (pending === request) pending = undefined
    }
  }

  function connect() {
    connected = true
    let closed = false
    const unsubscribe = auth.subscribe((event, ownerId) => {
      if (!automaticChecks || signingOut || event === 'INITIAL_SESSION') return
      const current = store.getState()
      if (event === 'SIGNED_OUT') {
        cancelChecks()
        sessionOwnerId = null
        callbackOwnerId = undefined
        update({ status: 'anonymous', starting: false, notice: sessionEnded })
        return
      }
      if (ownerId !== sessionOwnerId) {
        cancelChecks()
        sessionOwnerId = ownerId
        update({ status: 'checking' })
      } else if (event === 'SIGNED_IN' && current.status === 'ready') {
        return
      }
      // The SDK may hold its Auth lock while notifying listeners.
      clearTimeout(eventTimer)
      eventTimer = setTimeout(() => void verify(), 0)
    })
    startup ??= completeGoogleCallback(auth, navigation)
    void startup.then(({ notice, ownerId }) => {
      if (closed) return
      if (notice) update({ status: 'anonymous', starting: false, notice })
      else {
        callbackOwnerId = ownerId
        void verify()
      }
    })
    return () => {
      closed = true
      connected = false
      automaticChecks = false
      cancelChecks()
      unsubscribe()
    }
  }

  async function signIn() {
    const current = store.getState()
    if (current.status !== 'anonymous' || current.starting) return
    automaticChecks = false
    cancelChecks()
    update({ status: 'anonymous', starting: true })
    try {
      await auth.signInWithGoogle(new URL(callbackPath, navigation.currentUrl()).toString())
    } catch {
      if (connected) update({ status: 'anonymous', starting: false, notice: 'Couldn’t start Google sign-in. Try again.' })
    }
  }

  async function signOut() {
    if (signingOut) return
    signingOut = true
    automaticChecks = false
    cancelChecks()
    sessionOwnerId = null
    callbackOwnerId = undefined
    update({ status: 'checking' })
    try {
      await auth.signOut()
      if (connected) {
        navigation.replacePath('/sign-in')
        update({ status: 'anonymous', starting: false })
      }
    } catch {
      if (connected) update({ status: 'error', notice: 'Sign-out could not be confirmed. Try signing out again.' })
    } finally {
      signingOut = false
    }
  }

  function recheck() {
    if (automaticChecks && store.getState().status === 'ready' && globalThis.navigator?.onLine !== false) void verify()
  }

  function resume() {
    const current = store.getState()
    if (current.status === 'anonymous' && current.starting) update({ ...current, starting: false })
    recheck()
  }

  return { store, connect, signIn, signOut, retry: verify, recheck, resume }
}
