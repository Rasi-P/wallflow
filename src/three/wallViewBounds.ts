import { MathUtils, Vector3 } from 'three'
import type { Object3D } from 'three'
import { WALL_HEIGHT, WALL_WIDTH } from '../utils/constants.ts'

export const WALL_CAMERA_FOV = 38
export const MIN_CAMERA_DISTANCE = 5
export const MAX_CAMERA_DISTANCE = 45
const MIN_FRONT_RATIO = 0.18
const halfFovTangent = Math.tan(MathUtils.degToRad(WALL_CAMERA_FOV / 2))

// These vectors are scratch space for synchronous camera updates.
const localTarget = new Vector3()
const localCamera = new Vector3()
const offset = new Vector3()

export function constrainWallView(wall: Object3D, target: Vector3, position: Vector3, aspect: number): boolean {
  wall.worldToLocal(localTarget.copy(target))
  wall.worldToLocal(localCamera.copy(position))
  offset.subVectors(localCamera, localTarget)
  const distance = offset.length()
  if (distance === 0) return false

  let corrected = false
  // Keep the camera in front of the wall, even when both orbit and wall tilt are near their limits.
  if (offset.z < distance * MIN_FRONT_RATIO - 1e-8) {
    const lateral = Math.hypot(offset.x, offset.y)
    if (lateral === 0) offset.set(0, 0, distance)
    else {
      const scale = distance * Math.sqrt(1 - MIN_FRONT_RATIO ** 2) / lateral
      offset.set(offset.x * scale, offset.y * scale, distance * MIN_FRONT_RATIO)
    }
    corrected = true
  }

  // Bound the orbit pivot's depth so the viewing ray always reaches the face from the front.
  const depthLimit = offset.z * 0.6
  const depth = MathUtils.clamp(localTarget.z, -depthLimit, depthLimit)
  const reach = depth / offset.z
  const hitX = localTarget.x - offset.x * reach
  const hitY = localTarget.y - offset.y * reach
  const halfHeight = distance * halfFovTangent
  const limitX = WALL_WIDTH / 2 - MathUtils.clamp(halfHeight * aspect * 0.3, 0.6, 3)
  const limitY = WALL_HEIGHT / 2 - MathUtils.clamp(halfHeight * 0.3, 0.6, 3)
  const shiftX = MathUtils.clamp(hitX, -limitX, limitX) - hitX
  const shiftY = MathUtils.clamp(hitY, -limitY, limitY) - hitY

  if (!corrected && Math.abs(shiftX) + Math.abs(shiftY) + Math.abs(depth - localTarget.z) < 1e-8) return false
  localTarget.set(localTarget.x + shiftX, localTarget.y + shiftY, depth)
  wall.localToWorld(target.copy(localTarget))
  wall.localToWorld(position.copy(localTarget).add(offset))
  return true
}
