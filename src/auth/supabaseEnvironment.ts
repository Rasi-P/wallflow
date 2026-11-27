export const supabasePublicVariables = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
] as const

const privateKeyPattern = /sb_secret_[a-z0-9_-]+|eyJ[a-z0-9_-]{12,}\.eyJ[a-z0-9_-]{12,}\.[a-z0-9_-]{16,}/i

export function supabaseProjectOrigin(value: string): string {
  let project: URL
  try {
    project = new URL(value)
  } catch {
    throw new Error('VITE_SUPABASE_URL must be a project origin.')
  }
  if (privateKeyPattern.test(value) || privateKeyPattern.test(project.hostname)) {
    throw new Error('VITE_SUPABASE_URL must contain only a project origin.')
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(project.hostname)
  if ((project.protocol !== 'https:' && !(loopback && project.protocol === 'http:'))
    || project.username || project.password || project.pathname !== '/' || project.search || project.hash) {
    throw new Error('VITE_SUPABASE_URL must be an HTTPS project origin or a local loopback origin.')
  }
  return project.origin
}

export function checkSupabasePublishableKey(value: string) {
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(value) || privateKeyPattern.test(value)) {
    throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must contain a Supabase publishable key.')
  }
}
