import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, TOUCH, Vector2, Vector3 } from 'three'
import { OrbitControls } from 'three-stdlib'
import { createPaperGeometry } from '../src/three/paperGeometry.ts'
import { constrainWallView, MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE, WALL_CAMERA_FOV } from '../src/three/wallViewBounds.ts'
import { noteLayerDepth } from '../src/three/noteLayers.ts'
import { watchNotePointer } from '../src/three/notePointer.ts'
import { MAX_NOTES, WALL_HEIGHT, WALL_WIDTH } from '../src/utils/constants.ts'

test('desktop and mobile pan bounds retain the tilted wall at every zoom', () => {
  const wall = new Group()
  const geometry = new BoxGeometry(WALL_WIDTH, WALL_HEIGHT, 0.38)
  const surface = new Mesh(geometry)
  surface.position.z = -0.19
  wall.add(surface)
  const raycaster = new Raycaster()
  for (const aspect of [1440 / 900, 844 / 390, 390 / 844, 320 / 568]) {
    const camera = new PerspectiveCamera(WALL_CAMERA_FOV, aspect, 0.1, 110)
    for (const tilt of [-25, 0, 25]) {
      for (const turn of [-30, 0, 30]) {
        wall.rotation.set(tilt * Math.PI / 180, turn * Math.PI / 180, 0)
        wall.updateMatrixWorld(true)
        for (const [x, y, z] of [[80, 60, -12], [-80, -60, 12], [75, -75, 0]]) {
          const target = new Vector3(x, y, z)
          const offset = new Vector3(0.85, -0.55, 0.45)
          for (const distance of [MAX_CAMERA_DISTANCE, 14.6, MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE]) {
            camera.position.copy(target).add(offset.setLength(distance))
            constrainWallView(wall, target, camera.position, aspect)
            camera.lookAt(target)
            camera.updateMatrixWorld()
            raycaster.setFromCamera(new Vector2(), camera)
            assert.ok(raycaster.intersectObject(surface).length, `wall disappeared at aspect ${aspect}, tilt ${tilt}, turn ${turn}, zoom ${distance}`)
            assert.ok(Math.abs(camera.position.distanceTo(target) - distance) < 1e-8)
            assert.equal(constrainWallView(wall, target, camera.position, aspect), false, 'bound must settle')
          }
        }
      }
    }
  }
  geometry.dispose()
  surface.material.dispose()
})

test('a wall tilt leaves an already safe camera pose alone', () => {
  const wall = new Group()
  const position = new Vector3(0, 0.18, 14.6)
  const target = new Vector3(0, 0.18, 0)
  wall.rotation.set(0.25, -0.4, 0)
  assert.equal(constrainWallView(wall, target, position, 1440 / 900), false)
  assert.deepEqual(position.toArray(), [0, 0.18, 14.6])
  assert.deepEqual(target.toArray(), [0, 0.18, 0])
})

test('raycasting picks the exposed paper in a rotated wall with 60 notes', () => {
  const wall = new Group()
  const geometry = createPaperGeometry()
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const notes = Array.from({ length: MAX_NOTES }, (_, index) => {
    const mesh = new Mesh(geometry, material)
    mesh.position.set((index % 10 - 4.5) * 2.7, (Math.floor(index / 10) - 2.5) * 3, noteLayerDepth(index))
    wall.add(mesh)
    return mesh
  })
  const back = notes[0]
  const front = notes.at(-1)!
  front.position.set(back.position.x, back.position.y, front.position.z)
  wall.updateMatrixWorld(true)
  const aligned = new Raycaster(new Vector3(back.position.x, back.position.y, 10), new Vector3(0, 0, -1))
  assert.equal(aligned.intersectObjects(notes)[0]?.object, front)
  front.position.set(back.position.x + 0.75, back.position.y, front.position.z)
  for (const angles of [[0, 0], [0.38, -0.5]]) {
    wall.rotation.set(angles[0], angles[1], 0)
    wall.updateMatrixWorld(true)
    const normal = new Vector3(0, 0, 1).transformDirection(wall.matrixWorld)
    for (const [x, expected] of [[back.position.x + 0.5, front], [back.position.x - 1, back]] as const) {
      const origin = wall.localToWorld(new Vector3(x, back.position.y, 0)).addScaledVector(normal, 10)
      const hits = new Raycaster(origin, normal.clone().negate()).intersectObjects(notes)
      assert.equal(hits[0]?.object, expected)
    }
  }
  geometry.dispose()
  material.dispose()
})

function pointer(name: string, id: number, x = 0, y = 0) {
  return Object.assign(new Event(name), { pointerType: 'touch', pointerId: id, pageX: x, pageY: y, clientX: x, clientY: y })
}

test('note touch cancellation and a second contact release the gesture', () => {
  const surface = new EventTarget()
  const scheduled: FrameRequestCallback[] = []
  const nextFrame = (callback: FrameRequestCallback) => scheduled.push(callback)
  let canceled = 0
  const cancel = () => { canceled++ }

  const stop = watchNotePointer(surface, surface, 1, true, cancel, nextFrame)
  surface.dispatchEvent(pointer('pointerdown', 1))
  surface.dispatchEvent(pointer('pointercancel', 2))
  assert.equal(canceled, 0)
  surface.dispatchEvent(pointer('pointerdown', 2))
  assert.equal(canceled, 1)
  stop()

  const stopAfterUp = watchNotePointer(surface, surface, 1, true, cancel, nextFrame)
  surface.dispatchEvent(pointer('lostpointercapture', 1))
  stopAfterUp()
  scheduled.shift()!(0)
  assert.equal(canceled, 1, 'normal pointer-up must win the capture-loss race')

  const stopAfterCancel = watchNotePointer(surface, surface, 1, true, cancel, nextFrame)
  surface.dispatchEvent(pointer('pointercancel', 1))
  assert.equal(canceled, 2)
  stopAfterCancel()

  const stopAfterLoss = watchNotePointer(surface, surface, 1, true, cancel, nextFrame)
  surface.dispatchEvent(pointer('lostpointercapture', 1))
  scheduled.shift()!(0)
  assert.equal(canceled, 3)
  stopAfterLoss()
})

test('Escape cancels an active wall gesture and leaves later Escape presses alone', () => {
  const input = new EventTarget()
  let canceled = 0
  const stop = watchNotePointer(input, input, 7, false, () => { canceled++; stop() }, () => 0)
  const escape = () => Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' })
  assert.equal(input.dispatchEvent(escape()), false)
  assert.equal(canceled, 1)
  assert.equal(input.dispatchEvent(escape()), true)
  assert.equal(canceled, 1)
})

test('OrbitControls tracks one idle touch and pans and zooms when the second arrives', () => {
  const input = Object.assign(new EventTarget(), {
    style: {}, clientWidth: 390, clientHeight: 844, ownerDocument: new EventTarget(), releasePointerCapture() {},
  })
  const camera = new PerspectiveCamera(WALL_CAMERA_FOV, 390 / 844, 0.1, 110)
  camera.position.z = 14.6
  const controls = new OrbitControls(camera, input as unknown as HTMLElement)
  controls.touches = { ONE: undefined, TWO: TOUCH.DOLLY_PAN }
  input.dispatchEvent(pointer('pointerdown', 1, 100, 300))
  input.ownerDocument.dispatchEvent(pointer('pointermove', 1, 105, 305))
  assert.ok(Math.abs(controls.getDistance() - 14.6) < 1e-8)
  assert.equal(controls.target.lengthSq(), 0)
  input.dispatchEvent(pointer('pointerdown', 2, 220, 305))
  input.ownerDocument.dispatchEvent(pointer('pointermove', 2, 280, 345))
  assert.ok(controls.getDistance() < 14.6)
  assert.ok(controls.target.lengthSq() > 0)
  input.dispatchEvent(pointer('pointercancel', 2))
  input.ownerDocument.dispatchEvent(pointer('pointerup', 1))
  const afterCancel = camera.position.clone()
  input.ownerDocument.dispatchEvent(pointer('pointermove', 1, 900, 900))
  assert.deepEqual(camera.position.toArray(), afterCancel.toArray())
  controls.dispose()
})
