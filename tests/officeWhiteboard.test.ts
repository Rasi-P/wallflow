import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial,
  PerspectiveCamera, Raycaster, Texture, Vector3 } from 'three'
import {
  OFFICE_BOARD_THICKNESS, OFFICE_DOWNLIGHT, OFFICE_FRAME_WIDTH, OFFICE_KEY_POSITION, OFFICE_ROOM, OFFICE_ROOM_MAX_DISTANCE,
  officeWhiteboardFrame, officeWhiteboardLighting,
} from '../src/three/environments/officeWhiteboardLayout.ts'
import { buildOfficeWhiteboard } from '../src/three/environments/officeWhiteboardModel.ts'
import { conferenceTableFrame, conferenceTabletop, createConferenceChairs, shelfGlobe, TABLETOP_THICKNESS } from '../src/three/environments/officeWhiteboardFurnishings.ts'
import { officeBooks } from '../src/three/environments/officeWhiteboardBooks.ts'
import { officeCeiling, officeDownlightHousing, officeFootContacts, officeOcclusionTexture } from '../src/three/environments/officeWhiteboardLightingGeometry.ts'
import type { BufferGeometry } from 'three'
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
  assert.ok(defaults.key > defaults.ambient + defaults.hemisphere)
  const towardLight = new Vector3(...OFFICE_KEY_POSITION)
  const glassCrossing = towardLight.multiplyScalar(OFFICE_ROOM.left / towardLight.x)
  const window = OFFICE_ROOM.window
  assert.ok(glassCrossing.y > window.sill && glassCrossing.y < window.head)
  assert.ok(glassCrossing.z > window.rear && glassCrossing.z < window.front)
})

test('the recessed fixtures fit through real ceiling apertures without projecting into the room', () => {
  const { ceiling } = OFFICE_ROOM
  const { locations, z, aperture } = OFFICE_DOWNLIGHT
  const slab = officeCeiling(-0.52, 38)
  const material = new MeshBasicMaterial()
  const surface = new Mesh(slab, material)
  const ray = new Raycaster(new Vector3(), new Vector3(0, 1, 0))
  try {
    assert.ok(Math.abs(geometryBounds(slab).min.y - ceiling) < 1e-5)
    for (const x of locations) {
      ray.ray.origin.set(x, ceiling - 1, z)
      assert.deepEqual(ray.intersectObject(surface), [])
      ray.ray.origin.x = x + aperture + 0.10
      assert.ok(Math.abs(ray.intersectObject(surface)[0].point.y - ceiling) < 1e-5)

      const housing = officeDownlightHousing(x)
      try {
        const bounds = geometryBounds(housing)
        assert.ok(bounds.min.y >= ceiling && bounds.max.y < ceiling + 0.5)
        assert.ok(bounds.max.x > x + aperture && bounds.min.x < x - aperture)
      } finally {
        housing.dispose()
      }
    }
  } finally {
    slab.dispose()
    material.dispose()
  }
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
      'built-in oak uprights and open shelves', 'wide natural oak conference tabletop', 'upholstered side chairs',
      'individual leaves and branching stems', 'shelf globe', 'warm under-shelf strip lights',
      'matte ceiling and soffit', 'recessed warm downlight housings', 'floor and cabinet contact shadows']
    for (const name of names) assert.ok(model.room.getObjectByName(name), name)
    const ceiling = model.room.getObjectByName('matte ceiling and soffit')
    assert.ok(ceiling instanceof Mesh && ceiling.material instanceof MeshStandardMaterial)
    assert.equal(ceiling.material.roughness, 1)
    const downlights = model.room.getObjectByName('recessed warm downlight housings')
    assert.ok(downlights instanceof Mesh && downlights.material instanceof MeshStandardMaterial)
    assert.ok(downlights.material.emissiveIntensity < 0.1)
    assert.equal(downlights.castShadow, false)
    const foregroundContacts = model.room.getObjectByName('foreground chair contact shadows')
    assert.ok(foregroundContacts instanceof Mesh && foregroundContacts.material instanceof MeshBasicMaterial)
    assert.equal(foregroundContacts.parent, model.foreground)
    assert.equal(foregroundContacts.castShadow, false)
    assert.equal(foregroundContacts.material.depthWrite, false)
    const plants = model.room.getObjectByName('individual leaves and branching stems')
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
    // The separate ceiling and two contact batches add at most three meshes, with no extra shadow pass.
    assert.ok(batches <= 29, `too many room batches: ${batches}`)
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

function geometryBounds(geometry: BufferGeometry) {
  geometry.computeBoundingBox()
  return geometry.boundingBox!
}

test('soft contact patches match the existing chair and table feet', () => {
  const table = conferenceTableFrame()
  const chairs = createConferenceChairs(OFFICE_ROOM.floor)
  const stamp = officeOcclusionTexture()
  try {
    const legs = [table, ...chairs.map(({ frame }) => frame)]
    for (const geometry of legs) {
      const patches = officeFootContacts(geometry)
      assert.equal(patches.length, 4)
      const bounds = geometryBounds(geometry)
      for (const { x, y, z, width, strength } of patches) {
        assert.ok(x > bounds.min.x && x < bounds.max.x && z > bounds.min.z && z < bounds.max.z)
        assert.ok(y > OFFICE_ROOM.floor && y < OFFICE_ROOM.floor + 0.02)
        assert.ok(width > 1 && width < 2 && strength < 1)
      }
    }
    const { data, width, height } = stamp.image
    const alpha = (x: number, y: number) => data[(y * width + x) * 4 + 3]
    assert.ok(alpha(width / 2, height / 2) > alpha(width / 4, height / 2))
    assert.equal(alpha(0, 0), 0)
  } finally {
    stamp.dispose()
    table.dispose()
    for (const { frame, upholstery } of chairs) { frame.dispose(); upholstery.dispose() }
  }
})

test('four upholstered chairs have clear silhouettes and stay outside the table footprint', () => {
  const { table, floor } = OFFICE_ROOM
  const chairs = createConferenceChairs(floor)
  const tabletop = conferenceTabletop()
  const frame = conferenceTableFrame()
  try {
    assert.equal(chairs.length, 4)
    const tableBounds = geometryBounds(tabletop)
    const frameBounds = geometryBounds(frame)
    const footprint = tableBounds.clone().union(frameBounds)
    assert.ok(Math.abs(frameBounds.min.y - floor) < 1e-5)
    assert.ok(Math.abs(frameBounds.max.y - (table.top - TABLETOP_THICKNESS)) < 1e-5)
    const chairsAtFloor = chairs.map(({ upholstery, frame }) => {
      assert.ok(Math.abs(geometryBounds(frame).min.y - floor) < 0.005)
      const bounds = geometryBounds(upholstery).clone().union(geometryBounds(frame))
      assert.equal(bounds.intersectsBox(footprint), false)
      return bounds
    })
    for (const [index, chair] of chairsAtFloor.entries()) {
      assert.ok(chairsAtFloor.slice(index + 1).every((other) => !chair.intersectsBox(other)))
    }
    const vertex = new Vector3()
    for (const [width, height] of [[1672, 941], [1536, 1024], [1440, 900], [1024, 548], [800, 640]]) {
      const camera = overviewCamera(width, height)
      const boardBelow = vertex.set(0, -WALL_HEIGHT / 2, 0).project(camera).y
      const silhouettes = chairs.map(({ upholstery }) => {
        const box = new Box3()
        for (let i = 0; i < upholstery.attributes.position.count; i++) {
          box.expandByPoint(vertex.fromBufferAttribute(upholstery.attributes.position, i).project(camera))
        }
        assert.ok(box.max.y < boardBelow)
        return box
      }).sort((a, b) => a.min.x - b.min.x)
      for (let i = 1; i < silhouettes.length; i++) assert.ok(silhouettes[i].min.x - silhouettes[i - 1].max.x > 0.07)
    }
  } finally {
    tabletop.dispose()
    frame.dispose()
    for (const chair of chairs) { chair.upholstery.dispose(); chair.frame.dispose() }
  }
})

test('spaced books and page blocks stay in the cabinet bays and the lower globe has clearance', () => {
  const { cabinet } = OFFICE_ROOM
  const tops = [cabinet.baseTop, -1.91, 5.73] as const
  const { shelves, notebook } = officeBooks(tops)
  const books = [...shelves.flat(), notebook]
  const globe = shelfGlobe([(cabinet.left + cabinet.right) / 2 - 1.63, cabinet.baseTop, 1.22])
  try {
    const globeBounds = geometryBounds(globe.globe).clone().union(geometryBounds(globe.mount))
    for (const [row, volumes] of shelves.entries()) {
      const boxes = volumes.map(({ jacket }) => geometryBounds(jacket))
      for (const [index, bounds] of boxes.entries()) {
        assert.ok(bounds.min.x > cabinet.left + 0.44 && bounds.max.x < cabinet.right - 0.44)
        assert.ok(bounds.min.z > -0.19 && bounds.max.z < cabinet.front - 0.19)
        assert.ok(bounds.containsBox(geometryBounds(volumes[index].pages)))
        const supportingSurface = row === 1 && index === boxes.length - 1 ? boxes[index - 1].max.y : tops[row]
        assert.ok(Math.abs(bounds.min.y - supportingSurface) < 1e-5)
        assert.ok(bounds.max.y < (tops[row + 1] ?? cabinet.top) - 0.32)
        if (row === 0) assert.ok(bounds.min.x - globeBounds.max.x > 1)
        for (const next of boxes.slice(index + 1)) {
          // The horizontal volumes touch along their covers. They have no overlapping interior.
          const overlap = bounds.clone().intersect(next).getSize(new Vector3())
          assert.ok(overlap.x <= 1e-5 || overlap.y <= 1e-5 || overlap.z <= 1e-5)
        }
      }
    }
    assert.ok(Math.abs(geometryBounds(notebook.jacket).min.y - OFFICE_ROOM.table.top) < 1e-5)
  } finally {
    globe.globe.dispose()
    globe.mount.dispose()
    for (const volume of books) for (const geometry of Object.values(volume)) geometry.dispose()
  }
})

test('animated office plants clear the glass and shelves, and desktop foliage stays above the oak', () => {
  const cutaway = createBoardCutaway()
  const textures = { plaster: new Texture(), oak: new Texture(), sky: new Texture(), fabric: new Texture() }
  const model = buildOfficeWhiteboard(cutaway.planes, textures)
  try {
    const plants = model.room.getObjectByName('individual leaves and branching stems')
    assert.ok(plants instanceof Mesh)
    const { position, plantWind } = plants.geometry.attributes
    const { cabinet, table, left } = OFFICE_ROOM
    const worktopLeaves: Vector3[] = []
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
      const wind = plantWind.getX(i)
      if (x < 0) {
        assert.ok(x - wind > left + 0.35)
        assert.ok(z + wind < table.rear + 0.8 && x + wind < table.left)
      } else if (x > cabinet.left) {
        assert.ok(x + wind < cabinet.right - 0.44)
        assert.ok(y - wind > 5.73 && y + wind < cabinet.top - 0.4)
        assert.ok(z - wind > -0.19 && z + wind < cabinet.front - 0.19)
      } else {
        assert.ok(y - wind > table.top && z + wind < table.front)
        worktopLeaves.push(new Vector3(x, y + wind * 0.09, z - wind))
      }
    }
    const board = new Group()
    assert.ok(worktopLeaves.length > 0)
    for (const [width, height] of [[1672, 941], [1024, 548], [800, 640]]) {
      cutaway.update(board, overviewCamera(width, height).position)
      assert.ok(worktopLeaves.every((point) => cutaway.planes.some((plane) => plane.distanceToPoint(point) >= 0)),
        `tabletop foliage enters the board silhouette at ${width} × ${height}`)
    }
  } finally {
    model.dispose()
    Object.values(textures).forEach((texture) => texture.dispose())
  }
})
