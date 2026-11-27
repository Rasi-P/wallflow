import { MathUtils, Vector3 } from 'three'
import type { Object3D } from 'three'
import type { Point2, WallDocument } from '../types/wall.ts'
import { getNoteSize } from '../utils/noteDimensions.ts'
import { getSectionSize } from '../utils/wallSections.ts'
import { MAX_CAMERA_DISTANCE, WALL_CAMERA_FOV } from './wallViewBounds.ts'

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

export function wallFocusDistance(width: number, height: number, aspect: number) {
  const halfFov = Math.tan(MathUtils.degToRad(WALL_CAMERA_FOV / 2))
  const visibleHeight = Math.max(height, width / Math.max(aspect, 0.01))
  return MathUtils.clamp(visibleHeight * 1.25 / (2 * halfFov), 7, MAX_CAMERA_DISTANCE)
}

export function positionWallFocus(wall: Object3D, center: Point2, distance: number, target: Vector3, position: Vector3) {
  wall.localToWorld(target.set(center[0], center[1], 0))
  wall.localToWorld(position.set(center[0], center[1], distance))
}
