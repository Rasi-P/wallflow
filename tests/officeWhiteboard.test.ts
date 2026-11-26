import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3, BoxGeometry, Group, Mesh, MeshDepthMaterial, PerspectiveCamera, Raycaster, Texture, Vector3 } from 'three'
import {
  OFFICE_BOARD_THICKNESS, OFFICE_FRAME_WIDTH, OFFICE_KEY_POSITION, OFFICE_ROOM, OFFICE_ROOM_MAX_DISTANCE,
  officeWhiteboardFrame, officeWhiteboardLighting,
} from '../src/three/environments/officeWhiteboardLayout.ts'
import { buildOfficeWhiteboard } from '../src/three/environments/officeWhiteboardModel.ts'
import { compactStudyFrame, createBoardCutaway, ROOM_BOARD_CLEARANCE } from '../src/three/environments/studyRoomLayout.ts'
import { createPaperGeometry } from '../src/three/paperGeometry.ts'
import { constrainWallView, WALL_CAMERA_FOV } from '../src/three/wallViewBounds.ts'
import { DEFAULT_APPEARANCE } from '../src/utils/appearance.ts'
import { SAMPLE_NOTES, WALL_HEIGHT, WALL_WIDTH } from '../src/utils/constants.ts'
import { getNoteSize } from '../src/utils/noteDimensions.ts'

function overviewCamera(width: number, height: number) {
  const frame = officeWhiteboardFrame(width, height)
  assert.ok(frame)
  assert.ok(frame.distance <= OFFICE_ROOM_MAX_DISTANCE)
  const camera = new PerspectiveCamera(WALL_CAMERA_FOV, width / height, 0.1, 124)
  camera.position.set(frame.x, frame.y, frame.distance)
  camera.updateMatrixWorld()
  return camera
}

test('office overview keeps the deep foreground table, side glazing and tall cabinet balanced around the board', () => {
  const { left, window, cabinet, table, floor } = OFFICE_ROOM
  const halfWidth = WALL_WIDTH / 2 + OFFICE_FRAME_WIDTH
  const halfHeight = WALL_HEIGHT / 2 + OFFICE_FRAME_WIDTH
  for (const [width, height] of [[1672, 941], [1536, 1024], [1440, 900], [1280, 720], [1024, 768], [800, 640], [1720, 720]]) {
    const camera = overviewCamera(width, height)
    const point = (x: number, y: number, z: number) => new Vector3(x, y, z).project(camera)
    const boardTop = point(-halfWidth, halfHeight, 0)
    const boardBottom = point(halfWidth, -halfHeight, 0)
    const cabinetOutside = point(cabinet.right, cabinet.top, cabinet.front)
    const windowCorner = point(left, 0, window.rear)
    assert.ok(boardTop.x > windowCorner.x && (boardBottom.x - boardTop.x) / 2 >= 0.34)
    assert.ok(Math.abs(boardTop.y) < 0.82 && Math.abs(boardBottom.y) < 0.82)
    assert.ok(cabinetOutside.x <= 0.962 && cabinetOutside.y < 0.98)
    assert.ok(point(cabinet.left, floor, cabinet.front).x > boardBottom.x)
    assert.ok(windowCorner.x < -0.52, 'the left window projects into the left section')
    const tableRear = point(table.left, table.top, table.rear)
    const tableFrontLeft = point(table.left, table.top, table.front)
    const tableFrontRight = point(table.right, table.top, table.front)
    assert.ok(tableFrontLeft.x > -0.95 && tableFrontRight.x < 0.95)
    assert.ok(tableRear.y < boardBottom.y && tableFrontRight.y > -0.81, `table interrupts the board at ${width} × ${height}`)
    if (width === 1672) {
      assert.ok((boardBottom.x - boardTop.x) / 2 >= 0.46)
      assert.ok((tableFrontRight.x - tableFrontLeft.x) / 2 >= 0.8)
      assert.ok(cabinetOutside.y > 0.76, 'the storage is tall and reaches the soffit')
    }
  }
})

test('compact office home fits saved paper corners away from header and toolbar', () => {
  const insets = { top: 142, right: 14, bottom: 216, left: 18 }
  const rotation = [18, -24] as const
  const board = new Group()
  board.rotation.set(18 * Math.PI / 180, -24 * Math.PI / 180, 0)
  const notes = SAMPLE_NOTES.map((note, index) => ({
    ...note, position: [index % 2 ? -10 : 10, index - 3] as [number, number],
  }))
  for (const [width, height] of [[768, 1024], [393, 851], [851, 393]]) {
    assert.equal(officeWhiteboardFrame(width, height), null)
    const frame = compactStudyFrame(width, height, notes, [...rotation], insets)
    assert.ok(frame.maxDistance > frame.distance)
    const camera = new PerspectiveCamera(WALL_CAMERA_FOV, width / height, 0.1, frame.maxDistance + 52)
    const target = new Vector3(frame.x, frame.y, 0)
    camera.position.set(frame.x, frame.y, frame.distance)
    constrainWallView(board, target, camera.position, width / height)
    camera.lookAt(target)
    camera.updateMatrixWorld()
    for (const note of notes) {
      const [w, h] = getNoteSize(note)
      const sin = Math.sin(note.rotation), cos = Math.cos(note.rotation)
      for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) {
        const point = board.localToWorld(new Vector3(note.position[0] + x * cos - y * sin,
          note.position[1] + x * sin + y * cos, ROOM_BOARD_CLEARANCE)).project(camera)
        const screenX = (point.x + 1) * width / 2
        const screenY = (1 - point.y) * height / 2
        assert.ok(screenX >= insets.left && screenX <= width - insets.right)
        // Short landscape uses the compact minimum usable height when there is little space above the toolbar.
        if (height > 520) assert.ok(screenY >= insets.top && screenY <= height - insets.bottom)
      }
    }
  }
})

test('office light defaults to neutral daylight with bounded appearance controls', () => {
  const appearance = { ...DEFAULT_APPEARANCE, theme: 'office' as const }
  const defaults = officeWhiteboardLighting(appearance, 'daylight')
  assert.equal(defaults.keyColor, '#fcfdff')
  assert.equal(officeWhiteboardLighting(appearance, 'warm').keyColor, '#fff5e8')
  assert.ok(officeWhiteboardLighting({ ...appearance, intensity: 115 }, 'daylight').key > defaults.key)
  assert.ok(officeWhiteboardLighting({ ...appearance, ambience: 'quiet' }, 'daylight').ambient < defaults.ambient)
  const towardLight = new Vector3(...OFFICE_KEY_POSITION)
  const glassCrossing = towardLight.multiplyScalar(OFFICE_ROOM.left / towardLight.x)
  const window = OFFICE_ROOM.window
  assert.ok(glassCrossing.y > window.sill && glassCrossing.y < window.head)
  assert.ok(glassCrossing.z > window.rear && glassCrossing.z < window.front)
})

test('office geometry stays stationary, clips foreground obstructions, and passes raycasts through to notes', () => {
  const cutaway = createBoardCutaway()
  const textures = { plaster: new Texture(), oak: new Texture(), sky: new Texture(), fabric: new Texture() }
  const model = buildOfficeWhiteboard(cutaway.planes, textures)
  const paperGeometry = createPaperGeometry(0)
  const face = new BoxGeometry(WALL_WIDTH, WALL_HEIGHT, OFFICE_BOARD_THICKNESS)
  const board = new Group()
  const surface = new Mesh(face)
  surface.position.z = -OFFICE_BOARD_THICKNESS / 2
  const note = new Mesh(paperGeometry)
  note.position.set(-9, -7, 0.1)
  note.rotation.z = 0.12
  board.add(surface, note)
  const scene = new Group().add(board, model.room)
  try {
    const names = ['full-height charcoal glazing frames', 'floor-to-ceiling side glass', 'city and treetops beyond the glazing',
      'built-in oak uprights and open shelves', 'wide natural oak conference tabletop', 'upholstered side chairs and far seat',
      'window tree and trailing plants', 'shelf globe', 'warm under-shelf strip lights']
    for (const name of names) assert.ok(model.room.getObjectByName(name), name)
    const plants = model.room.getObjectByName('window tree and trailing plants')
    assert.ok(plants instanceof Mesh && plants.customDepthMaterial instanceof MeshDepthMaterial)
    assert.equal(plants.geometry.attributes.plantWind.count, plants.geometry.attributes.position.count)
    assert.equal(model.motionTime.value, 0)
    let batches = 0
    const geometries = new Set()
    model.room.traverse((object) => {
      if (!(object instanceof Mesh)) return
      batches++
      assert.ok(object.geometry.attributes.position.array.every(Number.isFinite), object.name)
      assert.equal(object.material.clippingPlanes, cutaway.planes, object.name)
      geometries.add(object.geometry)
    })
    assert.ok(batches <= 26, `too many room batches: ${batches}`)
    assert.ok(geometries.size < batches, 'box batches reuse geometry')
    face.computeBoundingBox()
    assert.ok(Math.abs(face.boundingBox!.max.z + surface.position.z) < 1e-8)

    const table = model.room.getObjectByName('wide natural oak conference tabletop')!
    const tableBounds = new Box3().setFromObject(table)
    assert.ok(Math.abs(tableBounds.max.z - OFFICE_ROOM.table.front) < 1e-5)
    assert.ok(Math.abs(tableBounds.max.y - OFFICE_ROOM.table.top) < 1e-5)
    assert.equal(model.room.getObjectByName('front upholstered chair backs')?.parent, model.foreground)
    const initialTablePosition = table.getWorldPosition(new Vector3())
    for (const [tilt, turn] of [[0, 0], [0.35, -0.42], [-0.4, 0.47]]) {
      board.rotation.set(tilt, turn, 0)
      scene.updateMatrixWorld(true)
      assert.deepEqual(table.getWorldPosition(new Vector3()), initialTablePosition)
      const eye = new Vector3(-22, -9, 41)
      cutaway.update(board, eye)
      const paper = note.getWorldPosition(new Vector3())
      const ray = new Raycaster(eye, paper.clone().sub(eye).normalize())
      assert.deepEqual(ray.intersectObject(model.room), [])
      assert.equal(ray.intersectObject(scene)[0]?.object, note)
      const foreground = eye.clone().lerp(paper, 0.8)
      assert.ok(cutaway.planes.every((plane) => plane.distanceToPoint(foreground) < 0))
    }
  } finally {
    model.dispose()
    face.dispose()
    paperGeometry.dispose()
    surface.material.dispose()
    note.material.dispose()
    Object.values(textures).forEach((texture) => texture.dispose())
  }
})
