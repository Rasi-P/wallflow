import type { BoardId } from '../types/workspace.ts'
import { readRecoveryEntries, removeRecoveryEntry, saveRecoveryEntry } from './boardLinkRecovery.ts'
import type { PendingSource } from './boardLinkRecovery.ts'

export const BOARD_LINK_PREFIX = 'wallflow-board-link-v1:'
type SourceRecord =
  | { sourceId: string; phase: 'local' | 'unknown' | 'linked' }
  | PendingSource

let durableSources = new Map<string, PendingSource>()
let recoveryRead: Promise<void> | undefined

export function restoreSourceProtection() {
  if (recoveryRead) return recoveryRead
  recoveryRead = readRecoveryEntries().then((entries) => {
    durableSources = new Map(entries.map(({ boardId, ...source }) => [boardId, source]))
  }).finally(() => { recoveryRead = undefined })
  return recoveryRead
}

function key(boardId: BoardId) { return BOARD_LINK_PREFIX + boardId }

function parseSource(raw: string | null): SourceRecord | undefined {
  if (!raw) return undefined
  try {
    const value = JSON.parse(raw)
    if (!value || typeof value.sourceId !== 'string' ||
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value.sourceId)) return undefined
    const sourceId = value.sourceId
    if (value.linked === true) return { sourceId, phase: 'linked' }
    if (value.phase === 'local') return { sourceId, phase: 'local' }
    if (value.phase === 'pending' && typeof value.accountId === 'string') {
      return { sourceId, phase: 'pending', accountId: value.accountId }
    }
    // Older records without a phase could already have been confirmed.
    return { sourceId, phase: 'unknown' }
  } catch {
    return undefined
  }
}

function sourceFromStorage(boardId: BoardId, raw: string | null) {
  const browser = parseSource(raw)
  if (browser?.phase === 'linked' || browser?.phase === 'pending') return browser
  return durableSources.get(boardId) ?? browser
}

export function readSource(boardId: BoardId) {
  try { return sourceFromStorage(boardId, localStorage.getItem(key(boardId))) }
  catch { return durableSources.get(boardId) }
}

export function isProtectedSource(boardId: BoardId) {
  try {
    const raw = localStorage.getItem(key(boardId))
    const record = sourceFromStorage(boardId, raw)
    return record ? record.phase !== 'local' : raw !== null
  } catch {
    return durableSources.has(boardId)
  }
}

export async function lockSource<T>(boardId: BoardId, action: (source: SourceRecord) => Promise<T>) {
  if (!navigator.locks || !globalThis.crypto?.subtle) {
    throw new Error('Connecting a board requires a secure browser with tab coordination. Your local board is still available.')
  }
  return navigator.locks.request(key(boardId), async () => {
    const raw = localStorage.getItem(key(boardId))
    const existing = sourceFromStorage(boardId, raw)
    if (existing) return action(existing)
    if (raw !== null) throw new Error('This board’s connection metadata cannot be read. Its local data has been kept.')
    const source = { sourceId: crypto.randomUUID(), phase: 'local' } as const
    localStorage.setItem(key(boardId), JSON.stringify(source))
    return action(source)
  })
}

export function recordSource(boardId: BoardId, source: SourceRecord) {
  if (readSource(boardId)?.sourceId !== source.sourceId) return false
  try {
    localStorage.setItem(key(boardId), JSON.stringify(source.phase === 'linked' ? { ...source, linked: true } : source))
    return true
  } catch { return false }
}

export function needsLinkRecovery(source: SourceRecord | undefined, accountId: string) {
  return source?.phase === 'unknown' || (source?.phase === 'pending' && source.accountId === accountId)
}

export async function protectSource(boardId: BoardId, source: PendingSource) {
  await saveRecoveryEntry(boardId, source)
  durableSources.set(boardId, source)
  if (!recordSource(boardId, source)) {
    throw new Error('Couldn’t protect the recovery copy in this browser. No confirmation was sent.')
  }
}

export async function releaseSource(boardId: BoardId, sourceId: string) {
  if (readSource(boardId)?.sourceId !== sourceId) return false
  // Only called after the server has ruled out a late confirmation.
  if (durableSources.has(boardId) || readSource(boardId)?.phase === 'pending') {
    await removeRecoveryEntry(boardId)
  }
  if (!recordSource(boardId, { sourceId, phase: 'local' })) return false
  durableSources.delete(boardId)
  return true
}
