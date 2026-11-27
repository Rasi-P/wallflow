import type { Point2, StickyNoteData, WallSection } from '../types/wall.ts'
import { WALL_HEIGHT, WALL_WIDTH } from './constants.ts'

export const SECTION_WIDTH = 7.4
export const SECTION_HEIGHT = 5.6
export const MAX_SECTIONS = 24
export const MAX_SECTION_NAME = 40

const PADDING = 0.15
export const MIN_SECTION_SIZE: Point2 = [2, 1.6]
export const MAX_SECTION_SIZE: Point2 = [WALL_WIDTH - 2 * PADDING, WALL_HEIGHT - 2 * PADDING]
const DEFAULT_SIZE: Point2 = [SECTION_WIDTH, SECTION_HEIGHT]

const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(maximum, value))

export function getSectionSize(section: WallSection): Point2 {
  return section.size ?? DEFAULT_SIZE
}

export function normalizeSectionSize([width, height]: Point2): Point2 {
  return [clamp(width, MIN_SECTION_SIZE[0], MAX_SECTION_SIZE[0]), clamp(height, MIN_SECTION_SIZE[1], MAX_SECTION_SIZE[1])]
}

export function clampSectionPosition([x, y]: Point2, [width, height]: Point2 = DEFAULT_SIZE): Point2 {
  const limitX = Math.max(0, (WALL_WIDTH - width) / 2 - PADDING)
  const limitY = Math.max(0, (WALL_HEIGHT - height) / 2 - PADDING)
  return [clamp(x, -limitX, limitX), clamp(y, -limitY, limitY)]
}

export function sectionBounds(section: WallSection) {
  const [x, y] = section.position
  const [width, height] = getSectionSize(section)
  return { left: x - width / 2, right: x + width / 2, top: y + height / 2, bottom: y - height / 2 }
}

export function resizeSectionFromCorner(section: WallSection, [x, y]: Point2) {
  const { left, top } = sectionBounds(section)
  const width = clamp(x - left, MIN_SECTION_SIZE[0], Math.max(MIN_SECTION_SIZE[0], WALL_WIDTH / 2 - PADDING - left))
  const height = clamp(top - y, MIN_SECTION_SIZE[1], Math.max(MIN_SECTION_SIZE[1], top + WALL_HEIGHT / 2 - PADDING))
  return { position: [left + width / 2, top - height / 2] as Point2, size: [width, height] as Point2 }
}

export function placeSection(sections: WallSection[], slots: Point2[], [width, height]: Point2 = DEFAULT_SIZE): Point2 {
  const [x, y] = slots[0] ?? [0, 0]
  const candidates = [...slots, [x, y] as Point2]
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1], [1, -1], [-1, -1], [1, 1], [-1, 1]]) {
    candidates.push([x + dx * (width + 0.35), y + dy * (height + 0.35)])
  }
  const positions = candidates.map((point) => clampSectionPosition(point, [width, height]))
  function clear([cx, cy]: Point2, xFraction: number, yFraction: number) {
    return sections.every((section) => {
      const [sx, sy] = section.position
      const [sw, sh] = getSectionSize(section)
      return Math.abs(cx - sx) >= (sw + width) * xFraction || Math.abs(cy - sy) >= (sh + height) * yFraction
    })
  }
  return positions.find((point) => clear(point, 0.52, 0.52))
    ?? positions.find((point) => clear(point, 0.335, 0.075))
    ?? positions[0]
}

function contains(section: WallSection, [x, y]: Point2) {
  const { left, right, top, bottom } = sectionBounds(section)
  return x >= left && x <= right && y >= bottom && y <= top
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
