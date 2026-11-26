import type { Lighting, NoteDefaults, WallAppearance, WallDocument } from './wall.ts'

export type BoardId = string

export interface Board {
  id: BoardId
  name: string
  document: WallDocument
  preferences: {
    noteDefaults: NoteDefaults
    showHints: boolean
    onboardingComplete: boolean
  }
  presentation: {
    lighting: Lighting
    appearance: WallAppearance
  }
  notifiedReminders: string[]
}

export interface SavedWorkspace {
  version: 2
  boardOrder: BoardId[]
  activeBoardId: BoardId
  boards: Record<BoardId, Board>
}
