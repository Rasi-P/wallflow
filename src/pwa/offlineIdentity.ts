type LocalSession = { user: { id: string }; access_token: string; expires_at?: number }
type VerifiedSession = { owner: string; proof: string }

export async function offlineSessionProof(session: LocalSession, now = Date.now()): Promise<VerifiedSession | null> {
  if (!session.user.id || !session.access_token || !Number.isFinite(session.expires_at)
    || session.expires_at! * 1000 <= now) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(session.access_token))
  const proof = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return { owner: session.user.id, proof }
}

export function matchesOfflineSession(saved: string | null, current: VerifiedSession | null) {
  return Boolean(current && saved === JSON.stringify(current))
}
