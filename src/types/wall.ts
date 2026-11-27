import type { SketchId } from '../utils/sketches.ts'

export type NoteColor = 'yellow' | 'pink' | 'green' | 'blue' | 'violet' | 'cream' | 'mint' | 'white' | 'grey'
export type PhotoWorkspace = 'professor' | 'teacher' | 'scientist'
export type InteractionMode = 'select' | 'pan' | 'orbit'
export type Lighting = 'daylight' | 'warm'
export type EnvironmentTheme = 'minimal' | 'office' | 'study' | 'studio' | 'lab'
export type WallShade = 'theme' | 'chalk' | 'ivory' | 'mist'
export type EnvironmentAmbience = 'theme' | 'quiet' | 'airy'
export type NoteTypography = 'handwritten' | 'sans'
export type NewNoteSize = 'compact' | 'standard' | 'large'
type NewNoteRotation = 'varied' | 'straight'
export type Point2 = [number, number]
export type TaskPriority = 'low' | 'medium' | 'high'

export interface WallAppearance {
  photoWorkspace?: Exclude<PhotoWorkspace, 'professor'>
  theme: EnvironmentTheme
  shade: WallShade
  intensity: number
  ambience: EnvironmentAmbience
}

export interface NoteDefaults {
  color: NoteColor
  typography: NoteTypography
  size: NewNoteSize
  rotation: NewNoteRotation
}

export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  plannedOn?: string
}

export interface NoteReminder {
  id: string
  at: number
}

export interface NoteTaskFields {
  checklist?: ChecklistItem[]
  priority?: TaskPriority
  dueDate?: string
  completed?: boolean
}

export interface StickyNoteData extends NoteTaskFields {
  id: string
  title: string
  body: string
  color: NoteColor
  typography?: NoteTypography
  position: Point2
  rotation: number
  size?: Point2
  doodle?: 'spark' | 'flower' | 'leaf' | SketchId
  inlineSketches?: true
  archived?: boolean
  sectionId?: string
  plannedOn?: string
  reminder?: NoteReminder
}

export interface WallSection {
  id: string
  name: string
  position: Point2
  size?: Point2
}

export interface WallDocument {
  notes: StickyNoteData[]
  sections: WallSection[]
  wallRotation: Point2
}
