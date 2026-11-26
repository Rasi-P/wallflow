import { MathUtils } from 'three'
import type { Lighting, WallAppearance } from '../../types/wall.ts'
import { environmentLighting } from '../../utils/appearance.ts'
import { WALL_CAMERA_FOV } from '../wallViewBounds.ts'

export const OFFICE_ROOM = {
  left: -25.35, right: 33.6, floor: -18.75, ceiling: 15.55, wallFace: -0.42,
  window: { rear: -0.34, front: 31.7, sill: -18.52, head: 15.34 },
  cabinet: { left: 17.75, right: 29.3, top: 13.6, front: 3.12, baseTop: -9.65 },
  table: { left: -17.0, right: 17.55, top: -10.62, rear: 7.2, front: 21.35 },
} as const

export const OFFICE_BOARD_THICKNESS = 0.23
export const OFFICE_FRAME_WIDTH = 0.18
export const OFFICE_ROOM_MAX_DISTANCE = 86
export const OFFICE_KEY_POSITION = [-43, 16, 32] as const
export const OFFICE_SUN_SHADOW = { radius: 8, intensity: 0.63 } as const
export const OFFICE_DOWNLIGHT = {
  locations: [-5.6, 6.9], z: 4.6, aperture: 0.33, angle: 0.50, penumbra: 0.82,
  range: 38, decay: 2, intensityPerKey: 21,
  targetY: 5.8, targetZ: 2.45, color: '#fff1e2',
} as const
const halfFov = Math.tan(MathUtils.degToRad(WALL_CAMERA_FOV / 2))

export function officeWhiteboardFrame(width: number, height: number) {
  const aspect = width / Math.max(height, 1)
  if (width <= 700 || height <= 520 || aspect < 1.25) return null

  const { cabinet, table } = OFFICE_ROOM
  const x = -0.7
  const y = -2.35 - MathUtils.clamp((aspect - 1.5) * 1.15, 0, 0.8)
  const halfWidth = halfFov * aspect
  const distance = Math.max(
    55.7,
    cabinet.front + (cabinet.right - x) / (0.96 * halfWidth),
    table.front + (table.right - x) / (0.94 * halfWidth),
    table.front + (y - table.top) / (0.8 * halfFov),
  )
  return { x, y, distance }
}

export function officeWhiteboardLighting(appearance: WallAppearance, lighting: Lighting) {
  const neutral = environmentLighting(appearance, 'daylight')
  return lighting === 'warm'
    ? { ...neutral, ambientColor: '#fffaf4', keyColor: '#fff5e8' }
    : neutral
}
