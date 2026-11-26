import { useStore } from 'zustand'
import { browserStorage, setStorageAvailable } from '../utils/storage.ts'
import { createWorkspaceStore } from './workspaceStore.ts'
import type { WallStore } from './boardStore.ts'
import type { SavedWorkspace } from '../types/workspace.ts'

export { clampPosition } from './boardStore.ts'

export const workspace = createWorkspaceStore(browserStorage, setStorageAvailable)
export const registerVisibleNoteSlots = workspace.registerVisibleNoteSlots
export const useWorkspaceStore = <T>(selector: (state: SavedWorkspace) => T) => useStore(workspace, selector)

export const useWallStore = Object.assign(
  <T>(selector: (state: WallStore) => T) => useStore(workspace.wall, selector),
  workspace.wall,
)
