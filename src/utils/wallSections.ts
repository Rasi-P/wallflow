import type { Point2, StickyNoteData, WallSection } from '../types/wall.ts'
import { WALL_HEIGHT, WALL_WIDTH } from './constants.ts'

export const SECTION_WIDTH = 7.4
export const SECTION_HEIGHT = 5.6
export const MAX_SECTIONS = 24
export const MAX_SECTION_NAME = 40

export function clampSectionPosition([x, y]: Point2): Point2 {
  const limitX = (WALL_WIDTH - SECTION_WIDTH) / 2 - 0.15
  const limitY = (WALL_HEIGHT - SECTION_HEIGHT) / 2 - 0.15
  return [Math.max(-limitX, Math.min(limitX, x)), Math.max(-limitY, Math.min(limitY, y))]
}

export function placeSection(sections: WallSection[], slots: Point2[]): Point2 {
  const [x, y] = slots[0] ?? [0, 0]
  const candidates = [...slots, [x, y] as Point2]
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    candidates.push([x + dx * (SECTION_WIDTH + 0.35), y + dy * (SECTION_HEIGHT + 0.35)])
  }
  const positions = candidates.map(clampSectionPosition)
  return positions.find(([cx, cy]) => sections.every(({ position: [sx, sy] }) =>
    Math.abs(cx - sx) >= SECTION_WIDTH + 0.2 || Math.abs(cy - sy) >= SECTION_HEIGHT + 0.2))
    ?? positions.find(([cx, cy]) => sections.every(({ position: [sx, sy] }) =>
      Math.abs(cx - sx) >= SECTION_WIDTH * 0.67 || Math.abs(cy - sy) >= SECTION_HEIGHT * 0.15))
    ?? positions[0]
}

function contains(section: WallSection, [x, y]: Point2) {
  return Math.abs(x - section.position[0]) <= SECTION_WIDTH / 2 &&
    Math.abs(y - section.position[1]) <= SECTION_HEIGHT / 2
}

export function sectionAt(sections: WallSection[], position: Point2, preferred?: string) {
  let closest: string | undefined
  let distance = Infinity
  for (const section of sections) {
    if (!contains(section, position)) continue
    if (section.id === preferred) return preferred
    const squared = (position[0] - section.position[0]) ** 2 + (position[1] - section.position[1]) ** 2
    if (squared < distance) {
      closest = section.id
      distance = squared
    }
  }
  return closest
}

export function withSection(note: StickyNoteData, sectionId?: string) {
  if (note.sectionId === sectionId) return note
  const next = { ...note, sectionId }
  if (sectionId === undefined) delete next.sectionId
  return next
}

export function adjustSectionMembership(notes: StickyNoteData[], sections: WallSection[], next: WallSection, before?: WallSection) {
  let changed = false
  const updated = notes.map((note) => {
    if (note.archived || (!contains(next, note.position) && !(before && contains(before, note.position)))) return note
    const updated = withSection(note, sectionAt(sections, note.position, note.sectionId))
    changed ||= updated !== note
    return updated
  })
  return changed ? updated : notes
}
