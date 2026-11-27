import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { Point2 } from '../types/wall.ts'
import type { Board, BoardId, SavedWorkspace } from '../types/workspace.ts'
import { stableJson } from '../utils/jsonContent.ts'
import { DEFAULT_FILTERS } from '../utils/noteSearch.ts'
import { createBoardStore, snapshotBoard } from './boardStore.ts'
import type { WallStore } from './boardStore.ts'
import { loadWorkspace, WORKSPACE_STORAGE_KEY } from './workspaceStorage.ts'
import type { WorkspaceStorage } from './workspaceStorage.ts'

const savedFields = [
  'wallName', 'notes', 'sections', 'wallRotation', 'lighting', 'appearance',
  'noteDefaults', 'showHints', 'onboardingComplete', 'notifiedReminders',
] as const satisfies readonly (keyof WallStore)[]

export function createWorkspaceStore(
  storage: WorkspaceStorage,
  setAvailable = (_available: boolean) => {},
  isProtectedSource = (_id: BoardId) => false,
  localInitiallyOpen = true,
) {
  const initial = loadWorkspace(storage)
  let { raw, protectedSave } = initial
  let local = initial.saved
  let migrateLocal = initial.migrate
  let localOpen = localInitiallyOpen
  const inactiveWall = createBoardStore({ blank: true })
  let linked: { saved: SavedWorkspace; changed: (saved: SavedWorkspace, busy: boolean) => void } | undefined
  const sessions = new Map<BoardId, { store: StoreApi<WallStore>; unsubscribe: () => void }>()
  const accountSessions = new Map<BoardId, { store: StoreApi<WallStore>; unsubscribe: () => void }>()
  const activeSessions = () => linked ? accountSessions : sessions
  let resolveVisibleSlots: (() => Point2[]) | undefined

  // Only the browser-local registry goes through the existing storage writer.
  function save(next: SavedWorkspace) {
    if (!protectedSave) {
      try {
        if (storage.getItem(WORKSPACE_STORAGE_KEY) === raw) {
          const encoded = JSON.stringify(next)
          storage.setItem(WORKSPACE_STORAGE_KEY, encoded)
          raw = encoded
          setAvailable(true)
          return true
        }
      } catch {
        // Keep the live workspace usable when storage is blocked or full.
      }
    }
    setAvailable(false)
    return false
  }

  function visibleWorkspace(active: BoardId): SavedWorkspace {
    if (linked) return linked.saved
    if (!localOpen) return { version: 2, boardOrder: [], boards: {}, activeBoardId: '' }
    const boardOrder = local.boardOrder.filter((id) => !isProtectedSource(id))
    const boards = Object.fromEntries(boardOrder.map((id) => [id, local.boards[id]]))
    if (!boardOrder.length) {
      const id = crypto.randomUUID()
      const blank = snapshotBoard(id, createBoardStore({ blank: true }).getState())
      local = { ...local, boardOrder: [...local.boardOrder, id], boards: { ...local.boards, [id]: blank }, activeBoardId: id }
      addSession(blank)
      boardOrder.push(id)
      boards[id] = blank
    }
    return { version: 2, boardOrder, boards, activeBoardId: Object.hasOwn(boards, active) ? active : boardOrder[0] }
  }

  function publish(active = registry.getState().activeBoardId) {
    const prior = registry.getState()
    const next = visibleWorkspace(active)
    const sameOrder = next.boardOrder.length === prior.boardOrder.length && next.boardOrder.every((id, index) => id === prior.boardOrder[index])
    registry.setState(sameOrder ? { ...next, boardOrder: prior.boardOrder } : next, true)
    wall.setState(activeStore().getState(), true)
  }

  function addSession(board: Board, account = false) {
    const { id } = board
    const store = createBoardStore({
      board,
      visibleSlots: () => id === registry.getState().activeBoardId ? resolveVisibleSlots?.() ?? [] : [],
    })
    const unsubscribe = store.subscribe((state, previous) => {
      const changed = savedFields.some((field) => state[field] !== previous[field])
      if (account) {
        if (!linked) return
        if (changed) {
          linked.saved = { ...linked.saved, boards: { ...linked.saved.boards, [id]: snapshotBoard(id, state) } }
          publish()
        } else if (registry.getState().activeBoardId === id) {
          wall.setState(state, true)
        }
        if (changed || state.editingId !== previous.editingId || state.draggingId !== previous.draggingId) {
          notifyAccount()
        }
        return
      }
      if (linked || !localOpen || isProtectedSource(id)) return
      if (changed) {
        local = { ...local, boards: { ...local.boards, [id]: snapshotBoard(id, state) } }
        save(local)
        publish()
      } else if (registry.getState().activeBoardId === id) {
        wall.setState(state, true)
      }
    })
    const stores = account ? accountSessions : sessions
    stores.set(id, { store, unsubscribe })
  }

  const registry = createStore<SavedWorkspace>(() => visibleWorkspace(local.activeBoardId))
  for (const id of local.boardOrder) if (!sessions.has(id)) addSession(local.boards[id])
  const activeStore = () => activeSessions().get(registry.getState().activeBoardId)?.store ?? inactiveWall
  const wall = createStore<WallStore>(() => activeStore().getState())
  if (migrateLocal && localOpen) migrateLocal = !save(local)
  else setAvailable(!protectedSave)

  function closeActiveView() {
    const store = activeStore()
    if (store.getState().draggingId) return false
    store.getState().finishEditing()
    store.setState({
      selectedId: null, selectedSectionId: null, filters: DEFAULT_FILTERS, mode: 'select', cameraCommand: null,
      searchOpen: false, settingsOpen: false, helpOpen: false, tasksOpen: false,
      archiveFocusId: null, tutorial: null,
    })
    return true
  }

  function carryDeviceState(to: BoardId) {
    const { today, reminderPermission, zoomPercent, zoomBounds } = activeStore().getState()
    activeSessions().get(to)!.store.setState({ today, reminderPermission, zoomPercent, zoomBounds })
  }

  function switchBoard(id: BoardId) {
    if ((!linked && isProtectedSource(id)) || !Object.hasOwn(registry.getState().boards, id)) return false
    if (registry.getState().activeBoardId === id) return true
    if (!closeActiveView()) return false
    carryDeviceState(id)
    if (linked) {
      linked.saved = { ...linked.saved, activeBoardId: id }
      publish()
      notifyAccount()
    } else {
      local = { ...local, activeBoardId: id }
      save(local)
      publish(id)
    }
    return true
  }

  function notifyAccount() {
    if (!linked) return
    const state = activeStore().getState()
    linked.changed(linked.saved, Boolean(state.editingId || state.draggingId))
  }

  function removeSession(id: BoardId, stores = sessions) {
    stores.get(id)?.unsubscribe()
    stores.delete(id)
  }

  function readLocalSnapshot(id: BoardId) {
    // Refuse an upload if storage failed or another tab changed the saved board.
    try {
      if (protectedSave || storage.getItem(WORKSPACE_STORAGE_KEY) !== raw) return undefined
      if (raw) {
        const original = (JSON.parse(raw) as SavedWorkspace).boards[id]
        const current = stableJson(local.boards[id])
        if (stableJson(original) !== current && stableJson(loadWorkspace(storage).saved.boards[id]) !== current) return undefined
      }
      return local.boards[id]
    } catch { return undefined }
  }

  return {
    getState: registry.getState,
    getInitialState: registry.getInitialState,
    subscribe: registry.subscribe,
    wall: {
      getState: () => activeStore().getState(),
      getInitialState: wall.getInitialState,
      subscribe: wall.subscribe,
      setState: (patch: Partial<WallStore> | ((state: WallStore) => Partial<WallStore>)) => activeStore().setState(patch),
    },
    registerVisibleNoteSlots(resolve: () => Point2[]) {
      resolveVisibleSlots = resolve
      return () => {
        if (resolveVisibleSlots === resolve) resolveVisibleSlots = undefined
      }
    },
    isLinked(id: BoardId) { return Boolean(linked && Object.hasOwn(linked.saved.boards, id)) },
    importableBoards(): Board[] {
      if (!raw && !migrateLocal) return []
      return local.boardOrder.flatMap((id) => {
        const snapshot = !isProtectedSource(id) && readLocalSnapshot(id)
        return snapshot ? [snapshot] : []
      })
    },
    matchesStoredSnapshot(board: Board) {
      return stableJson(readLocalSnapshot(board.id)) === stableJson(board)
    },
    keepLocalSnapshot(id: BoardId) {
      // A persisted source stays byte-for-byte intact. A fresh board must have a recovery copy before upload.
      try {
        if (storage.getItem(WORKSPACE_STORAGE_KEY) !== raw) return false
        return Boolean(raw && Object.hasOwn((JSON.parse(raw) as SavedWorkspace).boards, id)) || save(local)
      } catch { return false }
    },
    localIds() { return local.boardOrder },
    recoverySnapshot(id: BoardId) {
      try {
        const saved = storage.getItem(WORKSPACE_STORAGE_KEY)
        if (saved) {
          const board = (JSON.parse(saved) as SavedWorkspace).boards?.[id]
          if (board?.id === id) return board
        }
      } catch { /* Keep the in-memory copy available. */ }
      return local.boards[id]
    },
    revealLocalBoards() { if (localOpen && !linked) publish() },
    openLocalBoards() {
      if (localOpen || linked) return
      localOpen = true
      if (migrateLocal) migrateLocal = !save(local)
      publish(local.activeBoardId)
    },
    closeLocalBoards() {
      if (!localOpen) return
      localOpen = false
      publish()
    },
    setCloudWorkspace(saved: SavedWorkspace, changed: (workspace: SavedWorkspace, busy: boolean) => void) {
      localOpen = false
      for (const id of accountSessions.keys()) removeSession(id, accountSessions)
      linked = { saved, changed }
      for (const id of saved.boardOrder) addSession(saved.boards[id], true)
      publish()
    },
    clearLinkedBoard() {
      if (!linked) return
      for (const id of accountSessions.keys()) removeSession(id, accountSessions)
      linked = undefined
      publish(local.activeBoardId)
    },
    switchBoard,
    createBoard(name: string): BoardId | undefined {
      if ((!linked && !localOpen) || !name.trim()) return
      const id = crypto.randomUUID()
      const state = createBoardStore({ blank: true })
      state.getState().setWallName(name)
      const board = snapshotBoard(id, state.getState())
      if (linked) {
        const saved = linked.saved
        linked.saved = { ...saved, boardOrder: [...saved.boardOrder, id], boards: { ...saved.boards, [id]: board } }
        addSession(board, true)
        publish()
        notifyAccount()
      } else {
        local = { ...local, boardOrder: [...local.boardOrder, id], boards: { ...local.boards, [id]: board } }
        save(local)
        addSession(board)
        publish()
      }
      return id
    },
    renameBoard(id: BoardId, name: string) {
      const session = activeSessions().get(id)
      if (!session || (!linked && isProtectedSource(id)) || !Object.hasOwn(registry.getState().boards, id) || !name.trim()) return false
      session.store.getState().setWallName(name)
      return true
    },
    stepBoard(direction: -1 | 1) {
      const { boardOrder, activeBoardId } = registry.getState()
      const target = boardOrder[boardOrder.indexOf(activeBoardId) + direction]
      return target !== undefined && switchBoard(target)
    },
    deleteBoard(id: BoardId) {
      const current = registry.getState()
      if ((!linked && isProtectedSource(id)) || !Object.hasOwn(current.boards, id) || current.boardOrder.length === 1) return false
      const removingActive = current.activeBoardId === id
      if (removingActive && activeStore().getState().draggingId) return false
      const order = current.boardOrder.filter((entry) => entry !== id)
      const active = removingActive ? order[Math.min(current.boardOrder.indexOf(id), order.length - 1)] : current.activeBoardId
      if (linked) {
        const boards = { ...linked.saved.boards }
        delete boards[id]
        if (removingActive) carryDeviceState(active)
        removeSession(id, accountSessions)
        linked.saved = { ...linked.saved, boards, boardOrder: order, activeBoardId: active }
        publish()
        notifyAccount()
        return true
      }
      const boards = { ...local.boards }
      delete boards[id]
      const next = {
        ...local, boardOrder: local.boardOrder.filter((entry) => entry !== id), boards,
        activeBoardId: active,
      }
      if (!save(next)) return false
      if (removingActive) carryDeviceState(active)
      local = next
      removeSession(id)
      publish(active)
      return true
    },
    markBoardRemindersNotified(id: BoardId, receipts: string[]) {
      if (Object.hasOwn(registry.getState().boards, id)) activeSessions().get(id)?.store.getState().markRemindersNotified(receipts)
    },
    reload() {
      const retainedLinked = linked
      if (!retainedLinked) localOpen = true
      for (const id of sessions.keys()) removeSession(id)
      const loaded = loadWorkspace(storage)
      local = loaded.saved
      raw = loaded.raw
      protectedSave = loaded.protectedSave
      for (const id of local.boardOrder) addSession(local.boards[id])
      migrateLocal = loaded.migrate
      if (migrateLocal && localOpen && !linked) migrateLocal = !save(local)
      else setAvailable(!protectedSave)
      publish(local.activeBoardId)
    },
  }
}
