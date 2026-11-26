import { lazy, Suspense, useEffect } from 'react'
import { useStore } from 'zustand'
import { createAuthApi, submitGoogleLogin } from '../auth/api'
import { createAuthSession, loginNotice, SESSION_RECHECK_MS } from '../auth/session'
import { AuthLoading, SignIn } from '../auth/SignIn'

const Workspace = lazy(() => import('./App').then(({ App }) => ({ default: App })))
const auth = createAuthSession(
  createAuthApi(),
  submitGoogleLogin,
  window.location.pathname === '/sign-in' ? loginNotice(window.location.search) : undefined,
)

export function AuthGate() {
  const session = useStore(auth.store)

  useEffect(() => {
    void auth.verify()

    const onFocus = () => { void auth.refresh(15_000) }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void auth.verifyOnReturn()
    }

    window.addEventListener('focus', onFocus)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', onVisibilityChange)
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void auth.refresh()
    }, SESSION_RECHECK_MS / 10)

    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.clearInterval(interval)
    }
  }, [])

  if (session.status === 'checking') return <AuthLoading />
  if (session.status !== 'authenticated') {
    return <SignIn state={session} onContinue={auth.beginLogin} onRetry={auth.retry} />
  }

  return <Suspense fallback={<AuthLoading opening />}>
    <Workspace key={session.user.id} session={session} onSignOut={auth.signOut} />
  </Suspense>
}
