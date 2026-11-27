import type { SupabaseClient } from '@supabase/supabase-js'

export type WorkspacePreview = {
  id: string
  revision: string
  activeBoardId: string
  boards: { id: string; name: string; notes: { id: string; title: string }[] }[]
}

export class SupabaseWorkspaceDenied extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isWorkspacePreview(value: unknown): value is WorkspacePreview {
  return isRecord(value) && typeof value.id === 'string' && typeof value.revision === 'string'
    && /^[0-9]+$/.test(value.revision) && typeof value.activeBoardId === 'string' && Array.isArray(value.boards)
    && value.boards.every((board: unknown) => isRecord(board) && typeof board.id === 'string'
      && typeof board.name === 'string' && Array.isArray(board.notes)
      && board.notes.every((note: unknown) => isRecord(note) && typeof note.id === 'string' && typeof note.title === 'string'))
    && value.boards.some((board: WorkspacePreview['boards'][number]) => board.id === value.activeBoardId)
}

export function createSupabaseWorkspaceApi(client: SupabaseClient) {
  return {
    async open(ownerId: string, signal: AbortSignal): Promise<WorkspacePreview> {
      const parameters = { expected_owner_id: ownerId }
      const initialized = await client.rpc('initialize_wallflow_workspace', parameters).abortSignal(signal)
      if (initialized.error?.code === '42501') throw new SupabaseWorkspaceDenied()
      if (initialized.error || typeof initialized.data !== 'string') throw new Error('Workspace initialization failed.')

      const preview = await client.rpc('read_wallflow_workspace_preview', parameters).abortSignal(signal)
      if (preview.error?.code === '42501' || (!preview.error && preview.data === null)) throw new SupabaseWorkspaceDenied()
      if (preview.error || !isWorkspacePreview(preview.data) || preview.data.id !== initialized.data) {
        throw new Error('Workspace preview could not be verified.')
      }
      return preview.data
    },
  }
}
