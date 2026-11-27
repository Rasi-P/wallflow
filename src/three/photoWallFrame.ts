import type { Point2, WallDocument } from '../types/wall.ts'
import { WALL_HEIGHT, WALL_WIDTH } from '../utils/constants.ts'
import { getNoteSize } from '../utils/noteDimensions.ts'
import { getSectionSize } from '../utils/wallSections.ts'

export type WallFrameInsets = { left: number; right: number; top: number; bottom: number }

export function wallContentBounds(document: WallDocument) {
  let leftmost = Infinity, rightmost = -Infinity, highest = -Infinity, lowest = Infinity
  function include([x, y]: Point2, wide: number, tall: number) {
    leftmost = Math.min(leftmost, x - wide / 2)
    rightmost = Math.max(rightmost, x + wide / 2)
    lowest = Math.min(lowest, y - tall / 2)
    highest = Math.max(highest, y + tall / 2)
  }
  for (const note of document.notes) {
    if (note.archived) continue
    const [wide, tall] = getNoteSize(note)
    const cos = Math.abs(Math.cos(note.rotation)), sin = Math.abs(Math.sin(note.rotation))
    include(note.position, cos * wide + sin * tall, sin * wide + cos * tall)
  }
  for (const section of document.sections) include(section.position, ...getSectionSize(section))

  const hasContent = leftmost !== Infinity
  const content: Point2 = hasContent ? [(leftmost + rightmost) / 2, (lowest + highest) / 2] : [0, 0]
  const spanX = hasContent ? rightmost - leftmost + 0.64 : 0
  const spanY = hasContent ? highest - lowest + 0.66 : 0
  return { content, spanX, spanY }
}

export function photoWallFrame(width: number, height: number, document: WallDocument, insets: WallFrameInsets) {
  const portrait = width <= height
  const left = Math.max(width * (portrait ? 0.126 : 0.15), insets.left + 12)
  const right = Math.min(width * (portrait ? 0.905 : 0.86), width - insets.right - 12)
  const top = Math.min(height * 0.46, Math.max(height * 0.18, insets.top + 14))
  const bottom = Math.max(height * 0.54, Math.min(height * 0.84, height - insets.bottom - 14))
  const areaWidth = Math.max(1, right - left)
  const areaHeight = bottom - top
  const centre: Point2 = [(left + right - width) / 2, (height - top - bottom) / 2]

  const { content, spanX, spanY } = wallContentBounds(document)
  const scale = Math.min(areaWidth / Math.max(spanX, 8.2), areaHeight / Math.max(spanY, portrait ? 10 : 9.4))
  const overview = Math.min(areaWidth / WALL_WIDTH, areaHeight / WALL_HEIGHT)
  return {
    content, centre, areaWidth, areaHeight, scale,
    min: Math.min(scale * 0.8, overview),
    max: Math.max(scale * 2.5, Math.min(areaWidth, areaHeight) / 3.1),
  }
}

export function photoCameraTarget([x, y]: Point2, [offsetX, offsetY]: Point2, scale: number): Point2 {
  return [x - offsetX / scale, y - offsetY / scale]
}
