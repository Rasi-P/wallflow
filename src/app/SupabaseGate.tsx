import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { AuthLoading, SignIn } from '../auth/SignIn.tsx'
import { createSupabaseAuthApi } from '../auth/supabaseAuth.ts'
import { getSupabaseClient } from '../auth/supabaseClient.ts'
import { createSupabaseSession } from '../auth/supabaseSession.ts'
import { createSupabaseWorkspaceApi } from '../auth/supabaseWorkspace.ts'
import { exportAccountWorkspace, persistAccountDraft } from '../stores/linkedBoard'
import { mountSupabaseLinkedBoard } from '../stores/supabaseLinkedBoard'
import type { MountAccountBoard } from '../stores/linkedBoard'

const Workspace = lazy(() => import('./App').then(({ App }) => ({ default: App })))

function ConnectedWorkspace({ session, mountAccount }: {
  session: ReturnType<typeof createSupabaseSession>
  mountAccount: MountAccountBoard
}) {
  const state = useStore(session.store)
  const [deviceOnly, setDeviceOnly] = useState(false)
  useEffect(() => {
    const disconnect = session.connect()
    const recheck = () => {
      if (document.visibilityState === 'visible') session.recheck()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) session.resume()
    }
    const interval = window.setInterval(recheck, 30_000)
    for (const event of ['focus', 'online', 'offline']) window.addEventListener(event, recheck)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.clearInterval(interval)
      for (const event of ['focus', 'online', 'offline']) window.removeEventListener(event, recheck)
      window.removeEventListener('pageshow', onPageShow)
      document.removeEventListener('visibilitychange', recheck)
      disconnect()
    }
  }, [session])
  const verify = useCallback(() => { void session.retry() }, [session])
  const signOut = useCallback(async () => {
    const owner = session.store.getState()
    const saved = await persistAccountDraft()
    const current = session.store.getState()
    if (owner.status === 'ready' && (current.status !== 'ready' || current.account.id !== owner.account.id)) return
    if (!saved) {
      exportAccountWorkspace()
      if (!window.confirm('Browser storage could not save your draft. Sign out after keeping the downloaded copy?')) return
    }
    await session.signOut()
  }, [session])

  if (state.status === 'checking') return <AuthLoading />
  if (state.status === 'anonymous' && deviceOnly) {
    return <Suspense fallback={<AuthLoading opening />}>
      <Workspace onSignIn={() => setDeviceOnly(false)} onSessionInvalid={verify} />
    </Suspense>
  }
  if (state.status !== 'ready') {
    const signInState = state.status === 'blocked' ? { ...state, status: 'error' as const } : state
    return <SignIn state={signInState} onContinue={session.signIn} onRetry={() => void session.retry()}
      onUseDevice={state.status === 'anonymous' ? () => setDeviceOnly(true) : undefined}
      onExit={state.status === 'anonymous' ? undefined : signOut} exitLabel="Sign out" />
  }

  return <Suspense fallback={<AuthLoading opening />}>
    <Workspace key={state.account.id} account={state.account}
      mountAccount={mountAccount} onSignOut={signOut} onSessionInvalid={verify} />
  </Suspense>
}

export default function SupabaseGate() {
  const [deviceOnly, setDeviceOnly] = useState(false)
  const [setup] = useState(() => {
    try {
      const client = getSupabaseClient()
      const project = new URL(import.meta.env.VITE_SUPABASE_URL).origin
      const mountAccount: MountAccountBoard = (account, verify) => mountSupabaseLinkedBoard(client, project, account, verify)
      return { mountAccount, session: createSupabaseSession(createSupabaseAuthApi(client, project), createSupabaseWorkspaceApi(client), {
        currentUrl: () => window.location.href,
        replacePath: (path) => window.history.replaceState(null, '', path),
      }) }
    } catch {
      return { notice: 'Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to open your account workspace.' }
    }
  })
  if (setup.session) return <ConnectedWorkspace session={setup.session} mountAccount={setup.mountAccount} />
  if (deviceOnly) return <Suspense fallback={<AuthLoading opening />}>
    <Workspace onSignIn={() => setDeviceOnly(false)} onSessionInvalid={() => {}} />
  </Suspense>
  return <SignIn state={{ status: 'error', notice: setup.notice }} onUseDevice={() => setDeviceOnly(true)} onContinue={() => {}}
    onRetry={() => window.location.reload()} />
}
