import { lazy, Suspense, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { createAuthApi, submitGoogleLogin } from '../auth/api'
import { createAuthSession, loginNotice, SESSION_RECHECK_MS } from '../auth/session'
import type { AuthState } from '../auth/session'
import { AuthLoading, SignIn } from '../auth/SignIn'

const Workspace = lazy(() => import('./App').then(({ App }) => ({ default: App })))
const auth = createAuthSession(
  createAuthApi(),
  submitGoogleLogin,
  window.location.pathname === '/sign-in' ? loginNotice(window.location.search) : undefined,
)

function accountId(state: AuthState) {
  return state.status === 'authenticated' ? state.user.id : null
}

export function AuthGate() {
  const session = useStore(auth.store)
  const [deviceOnly, setDeviceOnly] = useState(false)

  useEffect(() => {
    let channel: BroadcastChannel | undefined
    try {
      if (typeof BroadcastChannel !== 'undefined') channel = new BroadcastChannel('wallflow-auth-session')
    } catch {
      // Periodic session verification still works if browser messaging is blocked.
    }
    let announced = accountId(auth.store.getState())
    const unsubscribe = auth.store.subscribe((next) => {
      if (next.status !== 'authenticated' && next.status !== 'anonymous') return
      const id = accountId(next)
      if (id !== announced) {
        announced = id
        channel?.postMessage({ accountId: id })
      }
    })
    if (channel) channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      const state = auth.store.getState()
      if (state.status === 'authenticated' && data && typeof data === 'object' && 'accountId' in data &&
        (data.accountId === null || typeof data.accountId === 'string') && data.accountId !== state.user.id) {
        // Conceal the workspace until the server confirms the session.
        void auth.verifyAfterAccountChange()
      }
    }
    void auth.verify()

    const onFocus = () => { void auth.refresh(15_000) }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void auth.verifyOnReturn()
    }

    const onOnline = () => {
      const current = auth.store.getState()
      if (current.status === 'authenticated' && current.recheckError) void auth.retry()
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void auth.refresh()
    }, SESSION_RECHECK_MS / 10)

    return () => {
      unsubscribe()
      channel?.close()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(interval)
    }
  }, [])

  if (session.status === 'checking') return <AuthLoading />
  if (session.status === 'anonymous' && deviceOnly) {
    return <Suspense fallback={<AuthLoading opening />}>
      <Workspace onSignIn={() => { setDeviceOnly(false); void auth.verify() }}
        onSignOut={auth.signOut} onRetrySession={auth.retry} onSessionInvalid={auth.verifyAfterAccountChange} />
    </Suspense>
  }
  if (session.status !== 'authenticated') {
    return <SignIn state={session} onContinue={auth.beginLogin} onRetry={auth.retry}
      onUseDevice={session.status === 'anonymous' ? () => setDeviceOnly(true) : undefined} />
  }

  return <Suspense fallback={<AuthLoading opening />}>
    {session.verifyingAccountChange && (session.recheckError
      ? <SignIn state={{ status: 'error', notice: session.recheckError }} onContinue={auth.beginLogin} onRetry={auth.retry} />
      : <AuthLoading />)}
    <div style={{ display: session.verifyingAccountChange ? 'none' : 'contents' }}>
      <Workspace key={session.user.id} session={session} onSignOut={auth.signOut} onRetrySession={auth.retry}
        onSessionInvalid={auth.verifyAfterAccountChange} />
    </div>
  </Suspense>
}
