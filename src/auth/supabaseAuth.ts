import { isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { Account, AuthSessionTransport } from '../types/auth.ts'
import { matchesOfflineSession, offlineSessionProof } from '../pwa/offlineIdentity.ts'
import { supabaseAuthStorageKey } from './supabaseClient.ts'

const endedSessions = new Set([
  'bad_jwt', 'session_not_found', 'session_expired', 'refresh_token_not_found',
  'refresh_token_already_used', 'user_not_found', 'user_banned',
])

function readAccount(user: User): Account {
  const displayName: unknown = user.user_metadata?.full_name
  return { id: user.id, email: user.email ?? null, displayName: typeof displayName === 'string' ? displayName : null }
}

export function createSupabaseAuthApi(client: SupabaseClient, project?: string): AuthSessionTransport {
  const storageKey = project ? supabaseAuthStorageKey(project) : undefined
  const lockKey = storageKey ? `${storageKey}:signed-out` : undefined
  const offlineKey = storageKey && `${storageKey}:offline-proof`
  let deviceLocked = false
  const locked = () => {
    try { return deviceLocked || Boolean(lockKey && globalThis.localStorage.getItem(lockKey)) }
    catch { return deviceLocked }
  }

  function forgetOfflineAccount() {
    try { if (offlineKey) globalThis.localStorage.removeItem(offlineKey) } catch { /* Storage can be unavailable. */ }
  }

  async function lockDeviceSession() {
    if (!lockKey || !storageKey) throw new Error('Offline sign-out is unavailable.')
    deviceLocked = true
    globalThis.localStorage.setItem(lockKey, '1')
    await client.auth.stopAutoRefresh()
    globalThis.localStorage.removeItem(storageKey)
    globalThis.localStorage.removeItem(`${storageKey}-user`)
  }

  return {
    async signInWithGoogle(redirectTo: string) {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, queryParams: { prompt: 'select_account' } },
      })
      if (error) throw error
    },
    async exchangeCode(code: string) {
      const { data, error } = await client.auth.exchangeCodeForSession(code)
      if (error || !data.session) throw new Error('OAuth exchange failed.')
      if (lockKey) globalThis.localStorage.removeItem(lockKey)
      deviceLocked = false
      return data.session.user.id
    },
    async currentAccount(): Promise<Account | null> {
      if (locked()) return null
      const { data, error } = await client.auth.getUser()
      if (locked()) return null
      if (error) {
        if (isAuthSessionMissingError(error) || endedSessions.has(error.code ?? '')) return null
        throw error
      }
      return data.user ? readAccount(data.user) : null
    },
    async offlineAccount() {
      if (!offlineKey || locked()) return null
      try {
        const saved = globalThis.localStorage.getItem(offlineKey)
        if (!saved) return null
        const { data: { session } } = await client.auth.getSession()
        if (!session || locked() || !matchesOfflineSession(saved, await offlineSessionProof(session))
          || globalThis.localStorage.getItem(offlineKey) !== saved) return null
        return readAccount(session.user)
      } catch { return null }
    },
    async rememberOfflineAccount(ownerId, signal) {
      if (!offlineKey || locked()) return
      try {
        const { data: { session } } = await client.auth.getSession()
        const proof = session?.user.id === ownerId ? await offlineSessionProof(session) : null
        if (proof && !signal.aborted && !locked()) globalThis.localStorage.setItem(offlineKey, JSON.stringify(proof))
      } catch { /* Offline access is optional when protected browser storage fails. */ }
    },
    forgetOfflineAccount,
    async signOut() {
      forgetOfflineAccount()
      if (lockKey && globalThis.navigator?.onLine === false) return lockDeviceSession()
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error && lockKey && isAuthRetryableFetchError(error)) return lockDeviceSession()
      if (error && !isAuthSessionMissingError(error) && !endedSessions.has(error.code ?? '')) throw error
    },
    subscribe(onChange) {
      const { data } = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') forgetOfflineAccount()
        if (!locked() || event === 'SIGNED_OUT') onChange(event, session?.user.id ?? null)
      })
      const onStorage = (event: StorageEvent) => {
        if (event.key === lockKey) {
          deviceLocked = Boolean(event.newValue)
          onChange(event.newValue ? 'SIGNED_OUT' : 'SIGNED_IN', null)
        }
      }
      if (lockKey) window.addEventListener('storage', onStorage)
      return () => {
        data.subscription.unsubscribe()
        if (lockKey) window.removeEventListener('storage', onStorage)
      }
    },
  }
}
