import { test } from 'node:test'
import assert from 'node:assert/strict'
import { BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Raycaster, TOUCH, Vector2, Vector3 } from 'three'
import { OrbitControls } from 'three-stdlib'
import { createPaperGeometry } from '../src/three/paperGeometry.ts'
import { noteLayerDepth } from '../src/three/noteLayers.ts'
import { watchNotePointer } from '../src/three/notePointer.ts'
import { MAX_NOTES, WALL_HEIGHT, WALL_WIDTH } from '../src/utils/constants.ts'

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
  const camera = new OrthographicCamera(-195, 195, 422, -422, 0.1, 60)
  camera.position.z = 14.6
  const controls = new OrbitControls(camera, input as unknown as HTMLElement)
  controls.touches = { ONE: undefined, TWO: TOUCH.DOLLY_PAN }
  input.dispatchEvent(pointer('pointerdown', 1, 100, 300))
  input.ownerDocument.dispatchEvent(pointer('pointermove', 1, 105, 305))
  assert.ok(Math.abs(controls.getDistance() - 14.6) < 1e-8)
  assert.equal(controls.target.lengthSq(), 0)
  input.dispatchEvent(pointer('pointerdown', 2, 220, 305))
  input.ownerDocument.dispatchEvent(pointer('pointermove', 2, 280, 345))
  assert.ok(camera.zoom > 1)
  assert.ok(controls.target.lengthSq() > 0)
  input.dispatchEvent(pointer('pointercancel', 2))
  input.ownerDocument.dispatchEvent(pointer('pointerup', 1))
  const afterCancel = camera.position.clone()
  input.ownerDocument.dispatchEvent(pointer('pointermove', 1, 900, 900))
  assert.deepEqual(camera.position.toArray(), afterCancel.toArray())
  controls.dispose()
})
