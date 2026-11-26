import { Euler, MathUtils, Plane, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { EnvironmentTheme, Lighting, Point2, StickyNoteData, WallAppearance } from '../../types/wall.ts'
import { WALL_HEIGHT, WALL_WIDTH } from '../../utils/constants.ts'
import { environmentLighting } from '../../utils/appearance.ts'
import { getNoteSize } from '../../utils/noteDimensions.ts'
import { MAX_CAMERA_DISTANCE, WALL_CAMERA_FOV } from '../wallViewBounds.ts'

// Keep the existing default theme ID so the installed room needs no storage migration.
export const isPersonalStudyRoom = (theme: EnvironmentTheme) => theme === 'minimal'
export const STUDY_ROOM = {
  left: -32.3, right: 33.1, ceiling: 14.2, floor: -19.35,
  window: { left: -27.05, right: -17.18, bottom: -8.25, top: 12.3 },
  desk: { left: -15.45, right: 15.95, surface: -11.85, rear: -0.18, front: 4.25 },
  shelf: { left: 17.95, right: 25.65, top: 4.35, rear: -0.24, front: 3.1 },
} as const
export const STUDY_ROOM_MAX_DISTANCE = 84
const halfFov = Math.tan(MathUtils.degToRad(WALL_CAMERA_FOV / 2))

export const STUDY_KEY_POSITION = [-23, 16, 25] as const
export const STUDY_WINDOW_LIGHT = {
  position: [-24, 15, 18],
  target: [-17, -9, 0],
  angle: 0.59,
  range: 72,
} as const

export function studyDaylightPositions(seconds: number) {
  const rise = 0.62 * Math.sin(seconds * Math.PI * 2 / 247)
  const drift = 0.74 * Math.sin(seconds * Math.PI * 2 / 313)
  const [x, y, z] = STUDY_KEY_POSITION
  const [targetX, targetY, targetZ] = STUDY_WINDOW_LIGHT.target
  return {
    sun: [x, y + rise, z + drift] as const,
    windowTarget: [targetX + drift * 0.47, targetY + rise * 0.38, targetZ] as const,
  }
}

export function studyRoomLighting(appearance: WallAppearance, lighting: Lighting) {
  const existing = environmentLighting(appearance, 'daylight')
  return {
    ...existing,
    ambientColor: '#fff8ef',
    sky: '#f8faff',
    ground: '#cdc3b3',
    keyColor: lighting === 'warm' ? '#fff3e6' : '#fcfdff',
    fillColor: '#eff2f6',
    ambient: existing.ambient * 0.77,
    key: existing.key * 0.78,
    fill: existing.fill * 1.1,
    hemisphere: existing.hemisphere * 0.99,
    windowColor: lighting === 'warm' ? '#fff3e6' : '#fffaf3',
    windowIntensity: existing.key * 680,
  }
}

export function studyRoomFrame(width: number, height: number) {
  const aspect = width / Math.max(height, 1)
  if (width <= 700 || height <= 520 || aspect < 1.25) return null
  const x = -0.55
  const y = -1.75 - MathUtils.clamp((aspect - 1.5) * 3.2, 0, 1.45)
  const { window, desk, shelf, floor } = STUDY_ROOM
  const horizontal = Math.max(
    0.35 + (x - window.left + 0.4) / (0.962 * halfFov * aspect),
    shelf.front + (shelf.right - x) / (0.962 * halfFov * aspect),
  )
  const vertical = Math.max(
    (window.top - y) / (0.81 * halfFov),
    desk.front + (y - floor) / (0.966 * halfFov),
  )
  return { x, y, distance: Math.max(53, horizontal, vertical) }
}

export type StudyViewportInsets = { top: number; right: number; bottom: number; left: number }

export function compactStudyFrame(width: number, height: number, notes: StickyNoteData[], rotation: Point2, insets: StudyViewportInsets) {
  const focalLength = height / (2 * halfFov)
  const usableWidth = Math.max(width - insets.left - insets.right, width / 2)
  const usableHeight = Math.max(height - insets.top - insets.bottom, height / 3)
  const orientation = new Euler(MathUtils.degToRad(rotation[0]), MathUtils.degToRad(rotation[1]), 0)
  const corner = new Vector3()
  let left = Infinity, right = -Infinity, bottom = Infinity, top = -Infinity, near = 0

  for (const note of notes) {
    if (note.archived) continue
    const [w, h] = getNoteSize(note)
    const cos = Math.cos(note.rotation), sin = Math.sin(note.rotation)
    for (const x of [-w / 2 - 0.14, w / 2 + 0.14]) {
      for (const y of [-h / 2 - 0.14, h / 2 + 0.14]) {
        for (const z of [0.02, ROOM_BOARD_CLEARANCE]) {
          corner.set(note.position[0] + x * cos - y * sin, note.position[1] + x * sin + y * cos, z).applyEuler(orientation)
          left = Math.min(left, corner.x)
          right = Math.max(right, corner.x)
          bottom = Math.min(bottom, corner.y)
          top = Math.max(top, corner.y)
          near = Math.max(near, corner.z)
        }
      }
    }
  }
  const empty = left === Infinity
  const spanX = empty ? 14 : Math.max(11.5, right - left + 0.68)
  const spanY = empty ? 9 : Math.max(7.5, top - bottom + 0.68)
  const distance = near + Math.max(14.6, focalLength * Math.max(spanX / usableWidth, spanY / usableHeight))
  const scale = (distance - near) / focalLength
  return {
    x: (empty ? 0 : (left + right) / 2) + (insets.right - insets.left) * scale / 2,
    y: (empty ? 0 : (bottom + top) / 2) + (insets.top - insets.bottom) * scale / 2,
    distance,
    maxDistance: Math.max(MAX_CAMERA_DISTANCE, distance * 1.13),
  }
}

const HALF_WIDTH = WALL_WIDTH / 2 + 0.06
const HALF_HEIGHT = WALL_HEIGHT / 2 + 0.06
// Covers note stacking, lifted paper and the resize handles above the wall face.
export const ROOM_BOARD_CLEARANCE = 0.32

export function createBoardCutaway() {
  const planes = Array.from({ length: 5 }, () => new Plane())
  const camera = new Vector3()
  const center = new Vector3()
  const points = Array.from({ length: 4 }, () => new Vector3())
  const back = new Plane(new Vector3(0, 0, -1))

  function update(board: Object3D, eye: Vector3) {
    camera.copy(eye)
    board.worldToLocal(camera)
    planes[4].copy(back).applyMatrix4(board.matrixWorld)
    if (camera.z <= ROOM_BOARD_CLEARANCE + 0.001) {
      // At a grazing close-up, keep the entire front half-space clear.
      for (let i = 0; i < 4; i++) planes[i].setComponents(0, 0, 1, -1e5)
      return
    }

    // Project a box containing the board and raised paper onto the board's face.
    const scale = camera.z / (camera.z - ROOM_BOARD_CLEARANCE)
    const left = Math.min(-HALF_WIDTH, camera.x + (-HALF_WIDTH - camera.x) * scale)
    const right = Math.max(HALF_WIDTH, camera.x + (HALF_WIDTH - camera.x) * scale)
    const bottom = Math.min(-HALF_HEIGHT, camera.y + (-HALF_HEIGHT - camera.y) * scale)
    const top = Math.max(HALF_HEIGHT, camera.y + (HALF_HEIGHT - camera.y) * scale)
    points[0].set(left, bottom, 0)
    points[1].set(right, bottom, 0)
    points[2].set(right, top, 0)
    points[3].set(left, top, 0)
    center.set((left + right) / 2, (top + bottom) / 2, 0)
    // Three.js discards a fragment when it is behind all five planes with clipIntersection.
    for (let i = 0; i < points.length; i++) {
      const side = planes[i].setFromCoplanarPoints(camera, points[i], points[(i + 1) % points.length])
      if (side.distanceToPoint(center) > 0) side.negate()
      side.applyMatrix4(board.matrixWorld)
    }
  }

  return { planes, update }
}
