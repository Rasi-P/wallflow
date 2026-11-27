import type { SupabaseClient } from '@supabase/supabase-js'
import type { LinkedDocument } from './linkedWallApi.ts'
import type { StickyNoteData } from '../types/wall.ts'
import type { SavedWorkspace } from '../types/workspace.ts'

export interface WorkspaceCommand {
  id: string
  base: LinkedDocument
  workspace: SavedWorkspace
}

export interface QuickCaptureResult {
  note: StickyNoteData | null
  noteId: string
  revision: string
}

export class WorkspaceCommandError extends Error {
  readonly reason: 'conflict' | 'auth' | 'network' | 'rejected'

  constructor(reason: WorkspaceCommandError['reason'], message: string) {
    super(message)
    this.reason = reason
  }
}

function document(value: unknown): LinkedDocument {
  const result = value as Partial<LinkedDocument> | null
  const saved = result?.workspace
  if (typeof result?.revision !== 'string' || !/^[0-9]+$/.test(result.revision) || !Array.isArray(result.claimedSources)
    || !saved || saved.version !== 2 || !Array.isArray(saved.boardOrder) || !saved.boards
    || !saved.boardOrder.includes(saved.activeBoardId) || !saved.boardOrder.every((id) => saved.boards[id]?.id === id)) {
    throw new WorkspaceCommandError('rejected', 'The account returned an invalid workspace.')
  }
  return { revision: result.revision, claimedSources: result.claimedSources, workspace: saved }
}

export function createSupabaseWorkspaceCommands(client: SupabaseClient, ownerId: string, lifetime: AbortSignal) {
  async function request(name: string, parameters: Record<string, unknown>): Promise<unknown> {
    const signal = AbortSignal.any([lifetime, AbortSignal.timeout(15_000)])
    const { data, error, status } = await client.rpc(name, { ...parameters, expected_owner_id: ownerId }).abortSignal(signal)
    if (error) {
      if (error.code === '42501' || status === 401 || status === 403) {
        throw new WorkspaceCommandError('auth', 'Sign in with this account to continue syncing.')
      }
      if (!status || status >= 500 || status === 429) throw new WorkspaceCommandError('network', 'Couldn’t reach account sync.')
      if (name === 'quick_capture_wallflow_note') {
        if (error.details === 'capture_conflict') {
          throw new WorkspaceCommandError('conflict', 'This capture request ID was already used.')
        }
        const message = error.details === 'board_full'
          ? 'The board has 60 active notes. Archive a note before capturing another.'
          : error.details === 'board_unavailable' ? 'The board is unavailable.' : 'The note could not be captured.'
        throw new WorkspaceCommandError('rejected', message)
      }
      throw new WorkspaceCommandError('rejected', name.includes('import')
        ? 'The import could not be confirmed. Review the browser boards and try again.'
        : 'The account declined these changes. Your draft remains available.')
    }
    if (data?.conflict === true) throw new WorkspaceCommandError('conflict', 'The workspace has a newer revision.')
    return data
  }

  return {
    async read(knownRevision: string | null = null) {
      const data = await request('read_wallflow_workspace', { known_revision: knownRevision })
      return data === null ? undefined : document(data)
    },
    async commit(command: WorkspaceCommand) {
      return document(await request('commit_wallflow_workspace', {
        operation_id: command.id, expected_revision: command.base.revision, next_document: command.workspace,
        removed_boards: command.base.workspace.boardOrder.filter((id) => !Object.hasOwn(command.workspace.boards, id)),
      }))
    },
    async quickCapture(operationId: string, content: string, boardId?: string): Promise<QuickCaptureResult> {
      const value = await request('quick_capture_wallflow_note', {
        operation_id: operationId, content, board_id: boardId ?? null,
      }) as Partial<QuickCaptureResult> | null
      if (!value || typeof value.noteId !== 'string' || typeof value.revision !== 'string' || !/^[0-9]+$/.test(value.revision)
        || (value.note !== null && value.note?.id !== value.noteId)) {
        throw new WorkspaceCommandError('rejected', 'The account returned an invalid capture receipt.')
      }
      return { note: value.note, noteId: value.noteId, revision: value.revision }
    },
    async prepare(sources: { sourceId: string; snapshotDigest: string }[]) {
      const intents = await request('prepare_wallflow_browser_import', { sources })
      if (!Array.isArray(intents) || intents.length !== sources.length || intents.some((entry) => typeof entry !== 'string')) {
        throw new WorkspaceCommandError('rejected', 'The import review could not be verified.')
      }
      return intents as string[]
    },
    async confirm(id: string, revision: string, reviewed: { intentId: string; snapshot: string }[]) {
      return document(await request('confirm_wallflow_browser_import', { operation_id: id, expected_revision: revision, reviewed }))
    },
    async recover(sourceId: string) {
      const value = await request('recover_wallflow_browser_import', { source_key: sourceId })
      if (value !== 'available' && value !== 'claimed' && value !== 'pending') {
        throw new WorkspaceCommandError('rejected', 'The import status could not be verified.')
      }
      return value
    },
  }
}
