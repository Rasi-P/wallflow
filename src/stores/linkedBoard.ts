import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { Account } from '../auth/api'
import { createLinkedWallApi, LinkedWallError } from '../auth/linkedWallApi'
import type { LinkedDocument } from '../auth/linkedWallApi'
import type { Board, SavedWorkspace } from '../types/workspace'
import {
  BOARD_LINK_PREFIX, lockSource, needsLinkRecovery, protectSource, readSource, recordSource, releaseSource, restoreSourceProtection,
} from '../utils/boardLinkStorage'
import { stableJson } from '../utils/jsonContent'
import { useWallStore, workspace } from './wallStore'

const VISIBLE_REFRESH_MS = 15_000

export type LinkedStatus = 'checking' | 'saved' | 'saving' | 'unsaved' | 'conflict' | 'unavailable' | 'offline'
export type LinkedState = {
  account?: Account; status: LinkedStatus; message?: string; linked: boolean
  hasRecovery?: boolean; recoveryPending?: boolean; importCount?: number
  supabase?: boolean; durable?: boolean
}
const state = createStore<LinkedState>(() => ({ status: 'checking', linked: false }))
export type AccountBoardClient = ReturnType<typeof runLinkedBoard> & {
  exportWorkspace?: () => void
  keepDraft?: () => void
  persistDraft?: () => Promise<boolean>
  restoreWorkspace?: (raw: string) => Promise<void>
}
let client: AccountBoardClient | undefined

export const useLinkedBoard = <T>(select: (state: LinkedState) => T) => useStore(state, select)

export function mountLinkedBoard(account: Account, verifySession: () => void) {
  return mountAccountBoard(account, () => runLinkedBoard(account.id, verifySession))
}

export function mountAccountBoard(
  account: Account,
  open: (update: (patch: Partial<LinkedState>) => void) => AccountBoardClient,
  supabase = false,
) {
  state.setState({ account, status: 'checking', linked: false, supabase }, true)
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
export function retryLinkedBoard() { return client?.retry() }
export function loadSavedLinkedBoard() { return client?.reloadSaved() }
export function exportLinkedChanges() { client?.download() }
export function exportBrowserRecovery() { client?.downloadRecovery() }
export function exportAccountWorkspace() { client?.exportWorkspace?.() }
export function keepLinkedDraft() { client?.keepDraft?.() }
export function persistAccountDraft() { return client?.persistDraft?.() ?? Promise.resolve(true) }
export async function restoreAccountWorkspace(raw: string) {
  if (!client?.restoreWorkspace) throw new Error('The account workspace is unavailable.')
  await client.restoreWorkspace(raw)
}

export function downloadSnapshot(snapshot: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function runLinkedBoard(accountId: string, verifySession: () => void) {
  const lifetime = new AbortController()
  const api = createLinkedWallApi(accountId, lifetime.signal)
  let base: LinkedDocument | undefined
  let draft: SavedWorkspace | undefined
  let busy = false
  let writing = false
  let reading = false
  let connecting = false
  let sourcesReady = false
  let conflict = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const closed = () => lifetime.signal.aborted
  const status = (next: LinkedStatus, message?: string) => {
    if (!closed()) state.setState({ status: next, message, linked: Boolean(base) })
  }

  function handle(error: unknown) {
    if (closed()) return
    if (error instanceof LinkedWallError && (error.code === 'auth_required' || error.code === 'account_changed')) {
      verifySession()
    }
    if (error instanceof LinkedWallError && error.status === 412) {
      conflict = true
      status('conflict', 'The account board changed on another device. Download your unsaved changes before loading the saved board.')
      return
    }
    status(draft ? 'unsaved' : 'unavailable', error instanceof Error ? error.message : 'Couldn’t reach the account board. Check your connection and try again.')
  }

  function changed(saved: SavedWorkspace, editing: boolean) {
    busy = editing
    if (!base || closed()) return
    draft = !writing && stableJson(saved) === stableJson(base.workspace) ? undefined : saved
    if (!draft && !writing && !conflict) status('saved')
    if (conflict || writing || !draft) return
    status('saving')
    schedule()
  }

  function schedule() {
    clearTimeout(timer)
    if (!closed() && !busy && draft && !conflict) timer = setTimeout(() => void flush(), 350)
  }

  async function flush() {
    if (!base || !draft || closed() || busy || writing || conflict || connecting) return
    writing = true
    const pending = draft
    try {
      const saved = await api.write(base, pending)
      if (closed()) return
      base = saved
      if (draft === pending || stableJson(draft) === stableJson(saved.workspace)) draft = undefined
      status(draft ? 'saving' : 'saved')
      if (draft) schedule()
    } catch (error) {
      if (!draft) draft = pending
      handle(error)
    } finally { writing = false }
  }

  function registerRecoveryCopy(document: LinkedDocument) {
    let hasRecovery = false
    for (const id of workspace.localIds()) {
      const source = readSource(id)
      if (!source || !document.claimedSources.includes(source.sourceId)) continue
      if (source.phase !== 'linked') recordSource(id, { sourceId: source.sourceId, phase: 'linked' })
      hasRecovery = true
    }
    state.setState({ hasRecovery })
  }

  function attach(document: LinkedDocument) {
    base = document
    draft = undefined
    busy = false
    conflict = false
    workspace.setCloudWorkspace(document.workspace, changed)
    registerRecoveryCopy(document)
    status('saved')
  }

  function publishSources() {
    workspace.revealLocalBoards()
    state.setState({
      recoveryPending: workspace.localIds().some((id) => needsLinkRecovery(readSource(id), accountId)),
      importCount: sourcesReady ? workspace.importableBoards().length : 0,
    })
  }

  async function recoverSources() {
    for (const id of workspace.localIds()) {
      if (closed() || connecting) return
      if (!needsLinkRecovery(readSource(id), accountId)) continue
      await lockSource(id, async (source) => {
        if (closed() || connecting || !needsLinkRecovery(source, accountId)) return
        const result = await api.recover(source.sourceId)
        if (closed() || result === 'pending') return
        const resolved = result === 'available'
          ? await releaseSource(id, source.sourceId)
          : recordSource(id, { sourceId: source.sourceId, phase: 'linked' })
        if (!resolved) {
          throw new Error('Couldn’t save the board connection status on this browser.')
        }
      })
    }
  }

  async function refresh() {
    if (closed() || busy || writing || reading || connecting || conflict || useWallStore.getState().draggingId || useWallStore.getState().editingId) return
    if (draft) { await flush(); return }
    reading = true
    try {
      const revision = base?.revision
      const document = await api.read(revision)
      if (revision !== base?.revision || closed() || busy || draft || writing || conflict || connecting || useWallStore.getState().draggingId || useWallStore.getState().editingId) return
      if (document) attach(document)

      if (!sourcesReady) {
        try {
          await restoreSourceProtection()
          sourcesReady = true
        } catch {
          // Browser recovery storage is required to expose local data, never to open the cloud board.
          if (base || closed()) return
          throw new Error('WALLFLOW couldn’t check browser recovery storage. Retry to open your boards.')
        }
      }
      if (closed() || connecting) return
      if (base) registerRecoveryCopy(base)
      try { await recoverSources() }
      catch (error) {
        if (!base || (error instanceof LinkedWallError && (error.code === 'auth_required' || error.code === 'account_changed'))) throw error
      }
    } catch (error) { handle(error) }
    finally {
      reading = false
      if (!closed() && !connecting) publishSources()
    }
  }

  async function importBoards(boards: Board[]) {
    if (!base || closed() || connecting || busy || writing || draft || conflict) {
      throw new Error('Save your cloud workspace before importing browser boards.')
    }
    connecting = true
    const ids = boards.map(({ id }) => id).sort()
    const sources = new Map<string, string>()
    async function withLocks(index: number): Promise<void> {
      if (index === ids.length) return upload()
      const id = ids[index]
      return lockSource(id, async ({ sourceId, phase }) => {
        if (phase !== 'local') throw new Error('Review the available browser boards again.')
        sources.set(id, sourceId)
        await withLocks(index + 1)
      })
    }
    function verifySnapshots() {
      if (closed() || draft || busy || boards.some((board) => !workspace.matchesStoredSnapshot(board))) {
        throw new Error('The workspace or browser boards changed. Review the boards again.')
      }
    }
    async function upload() {
      verifySnapshots()
      if (boards.some((board) => !workspace.keepLocalSnapshot(board.id))) {
        throw new Error('Couldn’t retain a browser recovery copy. No boards were imported.')
      }
      const snapshots = await Promise.all(boards.map(async (board) => {
        const snapshot = JSON.stringify(board)
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot))
        const snapshotDigest = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
        return { boardId: board.id, snapshot, snapshotDigest, sourceId: sources.get(board.id)! }
      }))
      const { intentIds } = await api.prepare(snapshots.map(({ sourceId, snapshotDigest }) => ({ sourceId, snapshotDigest })))
      if (intentIds.length !== snapshots.length) throw new Error('The server could not verify the review.')
      verifySnapshots()
      for (const { boardId, sourceId } of snapshots) {
        await protectSource(boardId, { sourceId, phase: 'pending', accountId })
      }
      verifySnapshots()
      let committed: LinkedDocument | undefined
      try {
        committed = await api.confirm(snapshots.map(({ snapshot }, index) => ({ snapshot, intentId: intentIds[index] })))
      } catch (failure) {
        if (closed()) return
        const recovered = await api.read()
        if (!recovered || !snapshots.every(({ sourceId }) => recovered.claimedSources.includes(sourceId))) throw failure
        committed = recovered
      }
      if (closed()) return
      if (draft) {
        registerRecoveryCopy(committed)
        handle(new LinkedWallError(412, 'revision_conflict', 'The account workspace changed.'))
      } else attach(committed)
    }
    try {
      if (!boards.length || new Set(ids).size !== ids.length) throw new Error('Choose browser boards to import.')
      await withLocks(0)
    } catch (error) {
      if (error instanceof LinkedWallError && (error.code === 'account_changed' || error.code === 'auth_required')) handle(error)
      throw error
    } finally {
      connecting = false
      if (!closed()) {
        publishSources()
        void refresh()
      }
    }
  }

  const unsubscribe = useWallStore.subscribe((next, previous) => {
    if ((previous.editingId || previous.draggingId) && !next.editingId && !next.draggingId) {
      queueMicrotask(() => { if (!base) void refresh() })
    }
  })
  function onVisible() { if (document.visibilityState === 'visible') void refresh() }
  const refreshInterval = window.setInterval(onVisible, VISIBLE_REFRESH_MS)
  function onStorage(event: StorageEvent) {
    if (event.key?.startsWith(BOARD_LINK_PREFIX)) {
      publishSources()
      void restoreSourceProtection().catch(() => {}).then(() => {
        if (closed()) return
        publishSources()
        void refresh()
      })
    }
  }
  function close() {
    lifetime.abort()
    unsubscribe()
    clearTimeout(timer)
    window.clearInterval(refreshInterval)
    window.removeEventListener('focus', onVisible)
    window.removeEventListener('online', onVisible)
    window.removeEventListener('storage', onStorage)
    document.removeEventListener('visibilitychange', onVisible)
    draft = undefined
    base = undefined
    workspace.closeLocalBoards()
    workspace.clearLinkedBoard()
  }

  window.addEventListener('focus', onVisible)
  window.addEventListener('online', onVisible)
  window.addEventListener('storage', onStorage)
  document.addEventListener('visibilitychange', onVisible)
  void refresh()

  return {
    importBoards, close, retry: refresh,
    async reloadSaved() {
      if (!conflict) return
      const discarded = draft
      try {
        const saved = await api.read()
        if (saved && !closed() && draft === discarded && !busy &&
          !useWallStore.getState().editingId && !useWallStore.getState().draggingId) attach(saved)
      } catch (error) { handle(error) }
    },
    download() {
      if (!draft || closed()) return
      downloadSnapshot(draft, 'wallflow-unsaved-workspace.json')
    },
    downloadRecovery() {
      if (!base || closed()) return
      const claimed = base.claimedSources
      const boards = workspace.localIds()
        .filter((id) => claimed.includes(readSource(id)?.sourceId ?? ''))
        .flatMap((id) => workspace.recoverySnapshot(id) ?? [])
      if (boards.length) downloadSnapshot(boards, 'wallflow-browser-recovery.json')
    },
  }
}
