import type { Point2, StickyNoteData } from '../types/wall.ts'
import { NOTE_HEIGHT, NOTE_WIDTH, WALL_HEIGHT, WALL_WIDTH } from './constants.ts'

const MIN_SCALE = 0.65
const MAX_SCALE = 2.2
const DEFAULT_SIZE: Point2 = [NOTE_WIDTH, NOTE_HEIGHT]
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

export const getNoteSize = (note: { size?: Point2 }) => note.size ?? DEFAULT_SIZE

export function normalizeNoteSize([width, height]: Point2): Point2 {
  return [clamp(width, NOTE_WIDTH * MIN_SCALE, NOTE_WIDTH * MAX_SCALE), clamp(height, NOTE_HEIGHT * MIN_SCALE, NOTE_HEIGHT * MAX_SCALE)]
}

export function clampNotePosition([x, y]: Point2, size = DEFAULT_SIZE, rotation = 0): Point2 {
  const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation))
  // Preserve the original wall margin for legacy notes and grow it only for larger footprints.
  const limitX = WALL_WIDTH / 2 - Math.max(NOTE_WIDTH, (c * size[0] + s * size[1]) / 2 + 0.15)
  const limitY = WALL_HEIGHT / 2 - Math.max(NOTE_HEIGHT, (s * size[0] + c * size[1]) / 2 + 0.15)
  return [clamp(x, -limitX, limitX), clamp(y, -limitY, limitY)]
}

function rotate([x, y]: Point2, radians: number): Point2 {
  const c = Math.cos(radians), s = Math.sin(radians)
  return [x * c - y * s, x * s + y * c]
}

export function resizeFromCorner(note: StickyNoteData, [sideX, sideY]: Point2, [dx, dy]: Point2) {
  const [width, height] = getNoteSize(note)
  const [localX, localY] = rotate([dx, dy], -note.rotation)
  const diagonalX = sideX * width, diagonalY = sideY * height
  const scale = 1 + (localX * diagonalX + localY * diagonalY) / (width ** 2 + height ** 2)
  const min = Math.max(NOTE_WIDTH * MIN_SCALE / width, NOTE_HEIGHT * MIN_SCALE / height)
  const max = Math.min(NOTE_WIDTH * MAX_SCALE / width, NOTE_HEIGHT * MAX_SCALE / height)
  const factor = clamp(scale, min, max)
  const size: Point2 = [width * factor, height * factor]
  const [offsetX, offsetY] = rotate([diagonalX * (factor - 1) / 2, diagonalY * (factor - 1) / 2], note.rotation)
  const position = clampNotePosition([note.position[0] + offsetX, note.position[1] + offsetY], size, note.rotation)
  return { size, position }
}
