import type { Board, SavedWorkspace } from '../types/workspace.ts'
import { createBoardStore, restoreWall, snapshotBoard } from './boardStore.ts'

export const WORKSPACE_STORAGE_KEY = 'wallflow-workspace-v2'
export const LEGACY_WALL_STORAGE_KEY = 'wallflow-wall-v1'
export const FIRST_BOARD_ID = 'first-board'

export type WorkspaceStorage = Pick<Storage, 'getItem' | 'setItem'>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parse(raw: string): unknown {
  try { return JSON.parse(raw) }
  catch { return null }
}

function readBoard(id: string, saved: Record<string, unknown>): Board | undefined {
  if (!Array.isArray(saved.notes)) return undefined
  const normalized = restoreWall(saved, createBoardStore({ blank: true }).getState())
  if (saved.notes.length && !normalized.notes.length) return undefined
  return snapshotBoard(id, normalized)
}

function singleBoard(board: Board): SavedWorkspace {
  return { version: 2, boardOrder: [board.id], activeBoardId: board.id, boards: { [board.id]: board } }
}

function readLegacy(raw: string | null) {
  if (raw === null) return undefined
  const saved = parse(raw)
  if (!isRecord(saved) || saved.version !== 1 || !isRecord(saved.state)) return undefined
  const board = readBoard(FIRST_BOARD_ID, saved.state)
  return board && singleBoard(board)
}

export function readWorkspace(raw: string): SavedWorkspace | undefined {
  const saved = parse(raw)
  if (!isRecord(saved) || saved.version !== 2 || !isRecord(saved.boards) || !Array.isArray(saved.boardOrder)) return undefined
  const seen = new Set<string>()
  const boards: [string, Board][] = []
  for (const id of saved.boardOrder) {
    if (typeof id !== 'string' || !id || seen.has(id) || !Object.hasOwn(saved.boards, id)) return undefined
    const value = saved.boards[id]
    if (!isRecord(value) || value.id !== id || typeof value.name !== 'string' ||
        !isRecord(value.document) || !Array.isArray(value.document.sections) ||
        !isRecord(value.preferences) || !isRecord(value.presentation) || !Array.isArray(value.notifiedReminders)) return undefined
    const board = readBoard(id, {
      notes: value.document.notes,
      sections: value.document.sections,
      wallRotation: value.document.wallRotation,
      noteDefaults: value.preferences.noteDefaults,
      showHints: value.preferences.showHints,
      onboardingComplete: value.preferences.onboardingComplete,
      lighting: value.presentation.lighting,
      appearance: value.presentation.appearance,
      notifiedReminders: value.notifiedReminders,
      wallName: value.name,
    })
    if (!board) return undefined
    boards.push([id, board])
    seen.add(id)
  }
  if (!boards.length || seen.size !== Object.keys(saved.boards).length ||
      typeof saved.activeBoardId !== 'string' || !seen.has(saved.activeBoardId)) return undefined
  return { version: 2, boardOrder: [...seen], activeBoardId: saved.activeBoardId, boards: Object.fromEntries(boards) }
}

export function loadWorkspace(storage: WorkspaceStorage) {
  const fresh = () => singleBoard(snapshotBoard(FIRST_BOARD_ID, createBoardStore().getState()))
  let raw: string | null = null
  try {
    raw = storage.getItem(WORKSPACE_STORAGE_KEY)
    if (raw !== null) {
      const saved = readWorkspace(raw)
      if (saved) return { saved, raw, migrate: false, protectedSave: false }
    }
    const legacyRaw = storage.getItem(LEGACY_WALL_STORAGE_KEY)
    const legacy = readLegacy(legacyRaw)
    return {
      saved: legacy ?? fresh(),
      raw,
      migrate: raw === null && legacy !== undefined,
      protectedSave: raw !== null || (legacyRaw !== null && !legacy),
    }
  } catch {
    return { saved: fresh(), raw, migrate: false, protectedSave: true }
  }
}
