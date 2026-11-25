import { NOTE_HEIGHT, NOTE_WIDTH, SAMPLE_NOTES } from '../utils/constants.ts'
import { MAX_CAMERA_DISTANCE, WALL_CAMERA_FOV } from './wallViewBounds.ts'

const halfFov = Math.tan(WALL_CAMERA_FOV * Math.PI / 360)
const minX = Math.min(...SAMPLE_NOTES.map(({ position }) => position[0]))
const maxX = Math.max(...SAMPLE_NOTES.map(({ position }) => position[0]))
const minY = Math.min(...SAMPLE_NOTES.map(({ position }) => position[1]))
const maxY = Math.max(...SAMPLE_NOTES.map(({ position }) => position[1]))

export function getStarterFrame(width: number, height: number) {
  const mobile = width <= 700
  const compactLandscape = mobile && width >= 540 && height <= 530
  // Reserve room for the welcome at the top and the resting floating tools below.
  const top = compactLandscape ? 96 : mobile ? 135 : height <= 530 ? 112 : height <= 720 ? 132 : 155
  const bottom = compactLandscape ? 118 : mobile ? height <= 700 ? 174 : 190 : height <= 720 ? 147 : 176
  const side = mobile ? 16 : Math.min(96, width * 0.08)
  const availableWidth = Math.max(1, width - side * 2)
  const availableHeight = Math.max(1, height - top - bottom)
  // The padding covers paper rotation, imperfect edges and the forward curl.
  const fitScale = Math.max((maxX - minX + NOTE_WIDTH + 0.4) / availableWidth, (maxY - minY + NOTE_HEIGHT + 0.4) / availableHeight)
  const distance = Math.min(MAX_CAMERA_DISTANCE, Math.max(14.6, fitScale * height / (2 * halfFov) + 0.25))
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2 + (top - bottom) * halfFov * distance / Math.max(1, height),
    distance,
    top,
    bottom,
    side,
  }
}
