import type { EnvironmentTheme, NoteColor, StickyNoteData } from '../types/wall.ts'
import { SAMPLE_NOTES } from './constants.ts'

export interface FirstWallOptions {
  starter: 'samples' | 'blank'
  theme?: EnvironmentTheme
  sampleSet?: 'professors-study'
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
  { target: 'camera', title: 'Look around the wall', description: 'Choose Pan and drag to move the view. Scroll or pinch to zoom. Choose Reset camera or press 0 to return.' },
] as const

const originalSamples = new Map(SAMPLE_NOTES.map((note) => [note.id, JSON.stringify(note)]))

export function removeUnchangedSamples(notes: StickyNoteData[]) {
  return notes.filter((note) => {
    const original = originalSamples.get(note.id)
    return original === undefined || original !== JSON.stringify(note)
  })
}

const professorSamples: StickyNoteData[] = [
  { id: 'professors-study-draft', title: 'Complete\nresearch draft', body: '', position: [-2.26, 5.3], rotation: 0.055, size: [3.95, 4.08], color: 'yellow', doodle: 'light-rays',
    checklist: [
      { id: 'revise', text: 'Revise introduction', done: false },
      { id: 'references', text: 'Add references', done: false },
      { id: 'proof', text: 'Final proof', done: false },
    ] },
  { id: 'professors-study-lecture-sample', title: 'Prepare\nnext lecture', body: '', position: [2.26, 5.28], rotation: -0.042, size: [3.95, 4.08], color: 'green', doodle: 'pencil',
    checklist: [
      { id: 'slides', text: 'Update slides', done: true },
      { id: 'examples', text: 'Add examples', done: true },
      { id: 'practice', text: 'Practice (15 min)', done: false },
    ] },
  { id: 'professors-study-reading', title: 'Read & make\nnotes', body: '', position: [-2.27, 0.07], rotation: -0.038, size: [3.95, 4.08], color: 'pink', doodle: 'open-book',
    checklist: [
      { id: 'article', text: 'Journal article', done: true },
      { id: 'case', text: 'Case study', done: true },
      { id: 'takeaways', text: 'Key takeaways', done: false },
    ] },
  { id: 'professors-study-meeting', title: 'Meeting with\nPhD student', body: 'Bring the latest outline.\n4:00 PM', position: [2.26, 0.01], rotation: 0.035,
    size: [3.95, 3.92], color: 'yellow', doodle: 'calendar' },
  { id: 'professors-study-proposal-plan', title: 'Plan research\nproposal', body: 'Map out the first experiment.', position: [0.65, -5.24], rotation: 0.071,
    size: [3.96, 3.72], color: 'blue', doodle: 'light-bulb' },
]

export function replaceUntouchedSamplesWithProfessorStudy(notes: StickyNoteData[]) {
  return notes.length === originalSamples.size && notes.every((note) => originalSamples.get(note.id) === JSON.stringify(note))
    ? structuredClone(professorSamples)
    : notes
}
