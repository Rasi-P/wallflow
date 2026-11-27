import type { SavedWorkspace } from '../types/workspace.ts'

export type LinkedDocument = { revision: string; workspace: SavedWorkspace; claimedSources: string[] }

export class LinkedWallError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

function readDocument(value: Partial<LinkedDocument> | undefined): LinkedDocument {
  const saved = value?.workspace
  if (!value || typeof value.revision !== 'string' || !/^[0-9]+$/.test(value.revision) ||
    !Array.isArray(value.claimedSources) || !saved || saved.version !== 2 || !Array.isArray(saved.boardOrder) ||
    !saved.boards || !saved.boardOrder.includes(saved.activeBoardId) ||
    !saved.boardOrder.every((id) => saved.boards[id]?.id === id && Array.isArray(saved.boards[id].document?.notes))) {
    throw new Error('Unsupported account workspace data.')
  }
  return value as LinkedDocument
}

export function createLinkedWallApi(accountId: string, lifetime: AbortSignal, fetcher: typeof fetch = fetch) {
  async function request(path: string, method = 'GET', body?: unknown, revision?: string) {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000)])
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Wallflow-Account': accountId }
    if (revision) headers[method === 'GET' ? 'If-None-Match' : 'If-Match'] = `"${revision}"`
    if (body !== undefined) {
      const csrf = await fetcher('/api/v1/auth/csrf/', { credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal })
      if (!csrf.ok) throw new LinkedWallError(csrf.status, 'csrf_failed', 'Couldn’t verify this request. Try again.')
      const { csrfToken } = await csrf.json()
      headers['X-CSRFToken'] = csrfToken
      headers['Content-Type'] = 'application/json'
    }
    const response = await fetcher('/api/v1/' + path, {
      method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error', signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (response.status === 304 && method === 'GET' && revision) return undefined
    const data = await response.json().catch(() => undefined)
    if (!response.ok) throw new LinkedWallError(response.status, data?.error?.code ?? '', data?.error?.message ?? 'Couldn’t reach the account workspace.')
    if (data === undefined) throw new Error('Unsupported account workspace response.')
    return data
  }

  return {
    async read(revision?: string): Promise<LinkedDocument | undefined> {
      const value = await request('workspace/', 'GET', undefined, revision)
      return value === undefined ? undefined : readDocument(value)
    },
    async prepare(sources: { sourceId: string; snapshotDigest: string }[]): Promise<{ intentIds: string[] }> {
      return request('workspace/import/prepare/', 'POST', { sources, expectedAccountId: accountId })
    },
    async confirm(boards: { intentId: string; snapshot: string }[]) {
      return readDocument(await request('workspace/import/confirm/', 'POST', { boards, expectedAccountId: accountId }))
    },
    async recover(sourceId: string): Promise<'available' | 'pending' | 'claimed'> {
      const { status } = await request('wall/link/recover/', 'POST', { sourceId, expectedAccountId: accountId })
      if (status !== 'available' && status !== 'pending' && status !== 'claimed') throw new Error('Unrecognized board import status.')
      return status
    },
    async write(previous: LinkedDocument, workspace: SavedWorkspace): Promise<LinkedDocument> {
      const removedBoards = previous.workspace.boardOrder.filter((id) => !Object.hasOwn(workspace.boards, id))
      return readDocument(await request('workspace/', 'PATCH', {
        workspace, removedBoards, expectedAccountId: accountId,
      }, previous.revision))
    },
  }
}
