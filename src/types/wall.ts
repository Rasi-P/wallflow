export type NoteColor = 'yellow' | 'pink' | 'green' | 'blue' | 'violet'
export type InteractionMode = 'select' | 'pan' | 'orbit'
export type Lighting = 'daylight' | 'warm'
export type Point2 = [number, number]
export type TaskPriority = 'low' | 'medium' | 'high'

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
  position: Point2
  rotation: number
  size?: Point2
  doodle?: 'spark' | 'flower' | 'leaf'
  archived?: boolean
  sectionId?: string
  plannedOn?: string
  reminder?: NoteReminder
}

export interface WallSection {
  id: string
  name: string
  position: Point2
}

export interface WallDocument {
  notes: StickyNoteData[]
  sections: WallSection[]
  wallRotation: Point2
}
