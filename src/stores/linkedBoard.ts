import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Account } from '../types/auth'
import type { Board } from '../types/workspace'
import type { CaptureInput, CaptureState } from '../utils/quickCapture'
import type { BrowserExportBoard } from '../utils/browserRecovery'

export type LinkedStatus = 'checking' | 'saved' | 'saving' | 'unsaved' | 'conflict' | 'unavailable' | 'offline'
type LinkedState = {
  account?: Account; status: LinkedStatus; message?: string; linked: boolean
  hasRecovery?: boolean; recoveryPending?: boolean; importCount?: number
  durable?: boolean
  capture?: CaptureState
}
const state = createStore<LinkedState>(() => ({ status: 'checking', linked: false }))
interface AccountBoardClient {
  close(): void
  captureNote(input: CaptureInput): Promise<void>
  changeCapture(id: string, retry: boolean): Promise<void>
  retry(): Promise<void>
  reloadSaved(): Promise<void>
  keepDraft(): void
  downloadRecovery(): void
  exportWorkspace(): void
  persistDraft(): Promise<boolean>
  reviewWorkspaceBackup(raw: string): () => Promise<void>
  importBoards(boards: Board[]): Promise<void>
  importExport(entries: BrowserExportBoard[]): Promise<void>
}

export type MountAccountBoard = (account: Account, verifySession: () => void) => () => void

let client: AccountBoardClient | undefined

export const useLinkedBoard = <T>(select: (state: LinkedState) => T) => useStore(state, select)

export function mountAccountBoard(
  account: Account,
  open: (update: (patch: Partial<LinkedState>) => void) => AccountBoardClient,
) {
  state.setState({ account, status: 'checking', linked: false }, true)
  let closed = false
  const active = open((patch) => { if (!closed) state.setState(patch) })
  client = active
  return () => {
    closed = true
    if (client !== active) return
    client = undefined
    active.close()
    state.setState({ status: 'checking', linked: false }, true)
  }
}

export async function importBrowserBoards(boards: Board[]) {
  if (!client) throw new Error('Sign in again to import browser boards.')
  await client.importBoards(boards)
}
export async function importBrowserExport(entries: BrowserExportBoard[]) {
  if (!client) throw new Error('Sign in again to import a browser export.')
  await client.importExport(entries)
}
export async function captureAccountNote(input: CaptureInput) {
  if (!client) throw new Error('Sign in to capture a note.')
  await client.captureNote(input)
}
export function changeAccountCapture(id: string, retry: boolean) { return client?.changeCapture(id, retry) }
export function retryLinkedBoard() { return client?.retry() }
export function loadSavedLinkedBoard() { return client?.reloadSaved() }
export function exportBrowserRecovery() { client?.downloadRecovery() }
export function exportAccountWorkspace() { client?.exportWorkspace() }
export function keepLinkedDraft() { client?.keepDraft() }
export function persistAccountDraft() { return client?.persistDraft() ?? Promise.resolve(true) }
export function reviewAccountWorkspaceBackup(raw: string) {
  if (!client) throw new Error('The account workspace is unavailable.')
  return client.reviewWorkspaceBackup(raw)
}

export function downloadSnapshot(snapshot: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
