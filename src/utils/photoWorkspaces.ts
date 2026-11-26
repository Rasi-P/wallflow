import type { NoteColor, PhotoWorkspace } from '../types/wall.ts'

export const PHOTO_WORKSPACES: Record<PhotoWorkspace, { name: string; asset: string; colors: readonly NoteColor[] }> = {
  professor: {
    name: 'Professor’s Study', asset: 'professors-study',
    colors: ['yellow', 'pink', 'green', 'blue', 'violet'],
  },
  teacher: {
    name: 'Teacher’s Planning Room', asset: 'teachers-planning-room',
    colors: ['pink', 'blue', 'green', 'yellow', 'cream', 'violet'],
  },
  scientist: {
    name: 'Scientist’s Thinking Lab', asset: 'scientists-thinking-lab',
    colors: ['green', 'mint', 'violet', 'blue', 'white', 'grey'],
  },
}

export function readPhotoWorkspace(value: unknown): PhotoWorkspace {
  return typeof value === 'string' && Object.hasOwn(PHOTO_WORKSPACES, value) ? value as PhotoWorkspace : 'professor'
}

export function photoPaperColors(workspace: PhotoWorkspace, current: NoteColor) {
  const { colors } = PHOTO_WORKSPACES[workspace]
  // Keep the current paper color available across environment changes.
  return colors.includes(current) ? colors : [...colors, current]
}
