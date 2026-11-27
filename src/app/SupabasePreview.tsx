import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { AuthLoading, SignIn } from '../auth/SignIn.tsx'
import { createSupabaseAuthApi } from '../auth/supabaseAuth.ts'
import { getSupabaseClient } from '../auth/supabaseClient.ts'
import { createSupabasePreviewSession } from '../auth/supabaseSession.ts'
import { createSupabaseWorkspaceApi } from '../auth/supabaseWorkspace.ts'
import { exportLinkedChanges, persistAccountDraft } from '../stores/linkedBoard'
import { mountSupabaseLinkedBoard } from '../stores/supabaseLinkedBoard'
import type { mountLinkedBoard } from '../stores/linkedBoard'

const Workspace = lazy(() => import('./App').then(({ App }) => ({ default: App })))

function ConnectedPreview({ session, mountAccount }: {
  session: ReturnType<typeof createSupabasePreviewSession>
  mountAccount: typeof mountLinkedBoard
}) {
  const state = useStore(session.store)
  useEffect(() => {
    const disconnect = session.connect()
    const recheck = () => {
      if (document.visibilityState === 'visible') session.recheck()
    }
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) session.resume()
    }
    const interval = window.setInterval(recheck, 30_000)
    for (const event of ['focus', 'online']) window.addEventListener(event, recheck)
    window.addEventListener('pageshow', onPageShow)
    document.addEventListener('visibilitychange', recheck)
    return () => {
      window.clearInterval(interval)
      for (const event of ['focus', 'online']) window.removeEventListener(event, recheck)
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
      exportLinkedChanges()
      if (!window.confirm('Browser storage could not save your draft. Sign out after keeping the downloaded copy?')) return
    }
    await session.signOut()
  }, [session])

  if (state.status === 'checking') return <AuthLoading />
  if (state.status !== 'ready') {
    const signInState = state.status === 'blocked' ? { ...state, status: 'error' as const } : state
    return <SignIn state={signInState} onContinue={session.signIn} onRetry={() => void session.retry()}
      onExit={state.status === 'anonymous' ? undefined : signOut} exitLabel="Sign out" />
  }

  return <Suspense fallback={<AuthLoading opening />}>
    <Workspace key={state.account.id} session={{ status: 'authenticated', user: state.account, signingOut: false }}
      mountAccount={mountAccount} onSignOut={signOut} onRetrySession={verify} onSessionInvalid={verify} />
  </Suspense>
}

export default function SupabasePreview() {
  const [setup] = useState(() => {
    try {
      const client = getSupabaseClient()
      const project = new URL(import.meta.env.VITE_SUPABASE_URL).origin
      const mountAccount: typeof mountLinkedBoard = (account, verify) => mountSupabaseLinkedBoard(client, project, account, verify)
      return { mountAccount, session: createSupabasePreviewSession(createSupabaseAuthApi(client, project), createSupabaseWorkspaceApi(client), {
        currentUrl: () => window.location.href,
        replacePath: (path) => window.history.replaceState(null, '', path),
      }) }
    } catch {
      return { notice: 'The Supabase preview needs a development project URL and publishable key.' }
    }
  })
  if (setup.session) return <ConnectedPreview session={setup.session} mountAccount={setup.mountAccount} />
  return <SignIn state={{ status: 'error', notice: setup.notice }} onContinue={() => {}}
    onRetry={() => window.location.reload()} />
}
