import type { AuthChangeEvent } from '@supabase/supabase-js'

export interface Account {
  id: string
  displayName: string | null
  email: string | null
}

export type SignInState =
  | { status: 'anonymous'; starting: boolean; notice?: string }
  | { status: 'error'; notice: string }

export interface AuthSessionTransport {
  signInWithGoogle(redirectTo: string): Promise<void>
  exchangeCode(code: string): Promise<string>
  currentAccount(): Promise<Account | null>
  signOut(): Promise<void>
  subscribe(onChange: (event: AuthChangeEvent, ownerId: string | null) => void): () => void
}
