import { createStore } from 'zustand/vanilla'
import type { StoreApi } from 'zustand/vanilla'
import type { Point2 } from '../types/wall.ts'
import type { Board, BoardId, SavedWorkspace } from '../types/workspace.ts'
import { DEFAULT_FILTERS } from '../utils/noteSearch.ts'
import { createBoardStore, snapshotBoard } from './boardStore.ts'
import type { WallStore } from './boardStore.ts'
import { loadWorkspace, WORKSPACE_STORAGE_KEY } from './workspaceStorage.ts'
import type { WorkspaceStorage } from './workspaceStorage.ts'

const savedFields = [
  'wallName', 'notes', 'sections', 'wallRotation', 'lighting', 'appearance',
  'noteDefaults', 'showHints', 'onboardingComplete', 'notifiedReminders',
] as const satisfies readonly (keyof WallStore)[]

export function createWorkspaceStore(storage: WorkspaceStorage, setAvailable = (_available: boolean) => {}) {
  const initial = loadWorkspace(storage)
  let { raw, protectedSave } = initial
  const registry = createStore<SavedWorkspace>(() => initial.saved)
  const sessions = new Map<BoardId, { store: StoreApi<WallStore>; unsubscribe: () => void }>()
  let resolveVisibleSlots: (() => Point2[]) | undefined

  function save(next: SavedWorkspace) {
    if (!protectedSave) {
      try {
        // Refuse to overwrite a workspace that changed since this tab loaded or saved it.
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

  function addSession(board: Board) {
    const { id } = board
    const store = createBoardStore({
      board,
      visibleSlots: () => id === registry.getState().activeBoardId ? resolveVisibleSlots?.() ?? [] : [],
    })
    const unsubscribe = store.subscribe((state, previous) => {
      if (savedFields.some((field) => state[field] !== previous[field])) {
        const workspace = registry.getState()
        const next = { ...workspace, boards: { ...workspace.boards, [id]: snapshotBoard(id, state) } }
        save(next)
        registry.setState(next, true)
      }
      if (registry.getState().activeBoardId === id) wall.setState(store.getState(), true)
    })
    sessions.set(id, { store, unsubscribe })
  }

  const activeStore = () => sessions.get(registry.getState().activeBoardId)!.store

  for (const id of initial.saved.boardOrder) addSession(initial.saved.boards[id])
  const wall = createStore<WallStore>(() => activeStore().getState())
  if (initial.migrate) save(initial.saved)
  else setAvailable(!protectedSave)

  function closeActiveView() {
    const store = activeStore()
    if (store.getState().draggingId) return false
    store.getState().finishEditing()
    store.setState({
      selectedId: null, filters: DEFAULT_FILTERS, mode: 'select', cameraCommand: null,
      searchOpen: false, settingsOpen: false, helpOpen: false, tasksOpen: false,
      archiveFocusId: null, tutorial: null,
    })
    return true
  }

  function carryDeviceState(to: BoardId) {
    const { today, reminderPermission, zoomPercent, zoomBounds } = activeStore().getState()
    sessions.get(to)!.store.setState({ today, reminderPermission, zoomPercent, zoomBounds })
  }

  function switchBoard(id: BoardId) {
    if (!sessions.has(id)) return false
    if (registry.getState().activeBoardId === id) return true
    if (!closeActiveView()) return false
    carryDeviceState(id)
    const next = { ...registry.getState(), activeBoardId: id }
    save(next)
    registry.setState(next, true)
    wall.setState(activeStore().getState(), true)
    return true
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
    createBoard(name: string): BoardId | undefined {
      if (!name.trim()) return
      const id = crypto.randomUUID()
      const state = createBoardStore({ blank: true })
      state.getState().setWallName(name)
      const board = snapshotBoard(id, state.getState())
      const current = registry.getState()
      const next = { ...current, boardOrder: [...current.boardOrder, id], boards: { ...current.boards, [id]: board } }
      save(next)
      addSession(board)
      registry.setState(next, true)
      return id
    },
    renameBoard(id: BoardId, name: string) {
      const session = sessions.get(id)
      if (!session || !name.trim()) return false
      session.store.getState().setWallName(name)
      return true
    },
    switchBoard,
    stepBoard(direction: -1 | 1) {
      const { boardOrder, activeBoardId } = registry.getState()
      const target = boardOrder[boardOrder.indexOf(activeBoardId) + direction]
      return target !== undefined && switchBoard(target)
    },
    deleteBoard(id: BoardId) {
      const session = sessions.get(id)
      if (!session || registry.getState().boardOrder.length === 1) return false
      const removingActive = registry.getState().activeBoardId === id
      if (removingActive && activeStore().getState().draggingId) return false
      const current = registry.getState()
      const index = current.boardOrder.indexOf(id)
      const boardOrder = current.boardOrder.filter((entry) => entry !== id)
      const activeBoardId = removingActive ? boardOrder[Math.min(index, boardOrder.length - 1)] : current.activeBoardId
      const boards = { ...current.boards }
      delete boards[id]
      const next = { ...current, boardOrder, activeBoardId, boards }
      // Avoid removing a board when the change cannot be saved.
      if (!save(next)) return false
      if (removingActive) carryDeviceState(activeBoardId)
      session.unsubscribe()
      sessions.delete(id)
      registry.setState(next, true)
      if (removingActive) wall.setState(activeStore().getState(), true)
      return true
    },
    markBoardRemindersNotified(id: BoardId, receipts: string[]) {
      sessions.get(id)?.store.getState().markRemindersNotified(receipts)
    },
    reload() {
      for (const session of sessions.values()) session.unsubscribe()
      sessions.clear()
      const loaded = loadWorkspace(storage)
      const { saved } = loaded
      raw = loaded.raw
      protectedSave = loaded.protectedSave
      for (const id of saved.boardOrder) addSession(saved.boards[id])
      if (loaded.migrate) save(saved)
      else setAvailable(!protectedSave)
      registry.setState(saved, true)
      wall.setState(activeStore().getState(), true)
    },
  }
}
