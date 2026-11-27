import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { checkSupabasePublishableKey, supabaseProjectOrigin } from './supabaseEnvironment.ts'

type SupabaseEnvironment = {
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_PUBLISHABLE_KEY?: string
}

export const supabaseAuthStorageKey = (project: string) => `wallflow-supabase-auth:${new URL(project).origin}`

export function createWallflowSupabaseClient(environment: SupabaseEnvironment): SupabaseClient {
  const url = environment.VITE_SUPABASE_URL?.trim()
  const key = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (!url || !key) {
    throw new Error('Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use Supabase.')
  }

  const projectOrigin = supabaseProjectOrigin(url)
  checkSupabasePublishableKey(key)
  return createClient(projectOrigin, key, {
    auth: { flowType: 'pkce', detectSessionInUrl: false, storageKey: supabaseAuthStorageKey(projectOrigin) },
  })
}

let client: SupabaseClient | undefined

export function getSupabaseClient(): SupabaseClient {
  return client ??= createWallflowSupabaseClient({
    VITE_SUPABASE_URL: import.meta.env?.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY,
  })
}
