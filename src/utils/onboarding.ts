import type { EnvironmentTheme, NoteColor, StickyNoteData } from '../types/wall.ts'
import { SAMPLE_NOTES } from './constants.ts'

export interface FirstWallOptions {
  starter: 'samples' | 'blank'
  theme?: EnvironmentTheme
  color?: NoteColor
  offerTutorial?: boolean
}

export type TutorialProgress = 'invite' | number | null

export const TUTORIAL_STEPS = [
  { target: 'add', title: 'Make your first note', description: 'Choose Add a note or press N. Write a title, then choose Done.' },
  { target: 'edit', title: 'Edit a note', description: 'Double-click a note, or select it and choose Edit. Open Task details to add a checklist, due date or reminder.' },
  { target: 'move', title: 'Move a note', description: 'In Select mode, drag a sticky note anywhere on the wall. Escape cancels the move.' },
  { target: 'resize', title: 'Resize your paper', description: 'Select a note, then drag a corner or choose Resize and use the plus and minus buttons.' },
  { target: 'find', title: 'Group notes into sections', description: 'Open Find, choose Sections, and add a label. Drag the label to place it, then drop notes inside the section.' },
  { target: 'tasks', title: 'Plan today and set reminders', description: 'Open the calendar to plan your day. Set a reminder in Task details and find it in the Reminders tab.' },
  { target: 'find', title: 'Search and filter', description: 'Use Find to search titles, descriptions and checklists. Apply filters and choose a result to focus it on the wall.' },
  { target: 'camera', title: 'Look around the wall', description: 'Choose Pan or Orbit to move the view. Scroll or pinch to zoom. Choose Reset camera or press 0 to return.' },
] as const

const originalSamples = new Map(SAMPLE_NOTES.map((note) => [note.id, JSON.stringify(note)]))

export function removeUnchangedSamples(notes: StickyNoteData[]) {
  return notes.filter((note) => {
    const original = originalSamples.get(note.id)
    return original === undefined || original !== JSON.stringify(note)
  })
}
