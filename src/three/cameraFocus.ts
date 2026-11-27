import type { WallDocument } from '../types/wall.ts'
import { getNoteSize } from '../utils/noteDimensions.ts'
import { getSectionSize } from '../utils/wallSections.ts'

export function resolveCameraFocus(document: WallDocument, kind: 'focus' | 'section', id?: string) {
  if (kind === 'section') {
    const section = document.sections.find((entry) => entry.id === id)
    if (!section) return
    const [width, height] = getSectionSize(section)
    return { center: section.position, width, height }
  }
  const note = document.notes.find((entry) => entry.id === id && !entry.archived)
  if (!note) return
  const [width, height] = getNoteSize(note)
  const cos = Math.abs(Math.cos(note.rotation)), sin = Math.abs(Math.sin(note.rotation))
  return { center: note.position, width: width * cos + height * sin, height: height * cos + width * sin }
}
