import { readWorkspace } from '../stores/workspaceStorage.ts'
import type { Board, SavedWorkspace } from '../types/workspace.ts'
import { sameWorkspaceValue } from './workspaceMerge.ts'

export const workspaceBackupFormat = 'wallflow-supabase-workspace'
export const workspaceBackupFileLimit = 7_000_000
export const browserExportFormat = 'wallflow-browser-export-v1'
export const recoveryFileLimit = 6_000_000
export type BrowserExportBoard = { sourceId: string; board: Board }

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

export function parseBrowserExport(raw: string): BrowserExportBoard[] {
  const value: unknown = parseRecoveryJson(raw)
  if (!value || typeof value !== 'object' || !('format' in value) || value.format !== browserExportFormat
    || !('boards' in value) || !Array.isArray(value.boards)) {
    throw new Error('Choose a browser boards export. Older recovery files need review before import.')
  }
  const invalid = 'The browser export contains invalid or repeated boards. Keep the original file.'
  if (!value.boards.length || value.boards.length > 250) throw new Error(invalid)
  const sources = new Set<string>()
  const boards = new Set<string>()
  for (const entry of value.boards) {
    if (!entry || typeof entry.sourceId !== 'string' || !uuid.test(entry.sourceId) || sources.has(entry.sourceId)
      || !entry.board || typeof entry.board.id !== 'string' || boards.has(entry.board.id)) throw new Error(invalid)
    const { id } = entry.board
    const check = readWorkspace(JSON.stringify({ version: 2, boardOrder: [id], activeBoardId: id, boards: { [id]: entry.board } }))
    if (!check || !sameWorkspaceValue(check.boards[id], entry.board)) throw new Error(invalid)
    sources.add(entry.sourceId)
    boards.add(id)
  }
  return value.boards
}

export async function reviewBrowserSource({ sourceId, board }: BrowserExportBoard) {
  const snapshot = JSON.stringify(board)
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot))
  const snapshotDigest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return { sourceId, snapshot, snapshotDigest }
}

function parseRecoveryJson(raw: string): unknown {
  try { return JSON.parse(raw) }
  catch { throw new Error('This recovery file is not valid JSON. Keep the original file.') }
}

export function parseWorkspaceBackup(raw: string, owner: { accountId: string; project: string }): SavedWorkspace {
  const backup = parseRecoveryJson(raw) as { format?: string; accountId?: string; project?: string; workspace?: SavedWorkspace } | null
  if (backup?.format !== workspaceBackupFormat || backup.accountId !== owner.accountId || backup.project !== owner.project
    || backup.workspace?.version !== 2 || !readWorkspace(JSON.stringify(backup.workspace))) {
    throw new Error('Select a workspace backup from this account and Supabase project.')
  }
  return backup.workspace
}
