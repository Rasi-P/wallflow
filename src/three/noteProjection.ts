import { Matrix4, Plane, Ray, Raycaster, Vector2, Vector3 } from 'three'
import type { Camera, Object3D } from 'three'
import type { Point2 } from '../types/wall.ts'

const wallInverse = new Matrix4()
const wallRay = new Ray()
const wallPlane = new Plane(new Vector3(0, 0, 1))
const wallHit = new Vector3()

export function projectOnWall(ray: Ray, wall: Object3D, depth = 0) {
  wall.updateWorldMatrix(true, false)
  wallInverse.copy(wall.matrixWorld).invert()
  wallPlane.constant = -depth
  return wallRay.copy(ray).applyMatrix4(wallInverse).intersectPlane(wallPlane, wallHit)
}

const spawnOffsets: Point2[] = [[0, 0.06], [-0.32, 0.06], [0.32, 0.06], [0, -0.25], [0, 0.38],
  [-0.52, 0.34], [0.52, 0.34], [-0.52, -0.24], [0.52, -0.24], [-0.63, 0.06], [0.63, 0.06]]
const raycaster = new Raycaster()
const cursor = new Vector2()

export function visibleWallSlots(camera: Camera, wall: Object3D): Point2[] {
  camera.updateMatrixWorld()
  const slots: Point2[] = []
  for (const [x, y] of spawnOffsets) {
    raycaster.setFromCamera(cursor.set(x, y), camera)
    const point = projectOnWall(raycaster.ray, wall)
    if (point) slots.push([point.x, point.y])
  }
  return slots
}
