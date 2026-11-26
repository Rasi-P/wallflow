import type { NoteColor, StickyNoteData } from '../types/wall.ts'

export const NOTE_COLORS: Record<NoteColor, { label: string; paper: string; ink: string; swatch: string }> = {
  yellow: { label: 'Butter yellow', paper: '#f4df88', ink: '#403a23', swatch: '#ecd571' },
  pink: { label: 'Petal pink', paper: '#edbbc8', ink: '#573740', swatch: '#e8b4c4' },
  green: { label: 'Sage green', paper: '#c9dbb6', ink: '#35482e', swatch: '#bfd0a9' },
  blue: { label: 'Sky blue', paper: '#bdd5e4', ink: '#304757', swatch: '#b5cedf' },
  violet: { label: 'Soft lilac', paper: '#d8c9e5', ink: '#493954', swatch: '#cfbbdf' },
}

export const NOTE_WIDTH = 2.62
export const NOTE_HEIGHT = 2.78
export const WALL_WIDTH = 32
export const WALL_HEIGHT = 22
export const MAX_NOTES = 60
export const MAX_BOARD_NAME_LENGTH = 48
export const MAX_TITLE_LENGTH = 72
export const MAX_BODY_LENGTH = 240

export const SAMPLE_NOTES: StickyNoteData[] = [
  { id: 'sample-project-design', title: 'Complete project design', body: 'Finish the layout and share a draft for feedback.', color: 'yellow', position: [-3.16, 3.30], rotation: 0.054 },
  { id: 'sample-weekly-plan', title: 'Prepare weekly plan', body: 'Pick three priorities and block time for each.', color: 'pink', position: [0.05, 3.17], rotation: -0.035 },
  { id: 'sample-research', title: 'Read research paper', body: 'Highlight the findings and write a short summary.', color: 'green', position: [3.25, 3.35], rotation: 0.042 },
  { id: 'sample-meeting', title: 'Important meeting', body: 'Review the agenda and bring two questions.', color: 'blue', position: [-1.72, 0.04], rotation: -0.049 },
  { id: 'sample-product-idea', title: 'New product idea', body: 'Sketch the idea and ask someone to try it.', color: 'yellow', position: [1.48, -0.08], rotation: 0.065, doodle: 'spark' },
  { id: 'sample-review', title: 'Review pending tasks', body: 'Check deadlines and choose what to finish today.', color: 'violet', position: [-2.69, -3.18], rotation: 0.027 },
  { id: 'sample-learn', title: 'Learn something new', body: 'Spend 20 minutes practicing one useful skill.', color: 'green', position: [0.59, -3.38], rotation: -0.057 },
]
