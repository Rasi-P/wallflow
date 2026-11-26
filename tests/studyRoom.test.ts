import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Euler, Group, MathUtils, Mesh, PerspectiveCamera, Raycaster, SpotLight, Texture, Vector3 } from 'three'
import { constrainWallView, MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE } from '../src/three/wallViewBounds.ts'
import { MAX_NOTES, SAMPLE_NOTES, WALL_HEIGHT, WALL_WIDTH } from '../src/utils/constants.ts'
import type { Point2, StickyNoteData } from '../src/types/wall.ts'
import { getNoteSize } from '../src/utils/noteDimensions.ts'
import { DEFAULT_APPEARANCE, THEME_PRESETS, wallFinish } from '../src/utils/appearance.ts'
import {
  compactStudyFrame, createBoardCutaway, isPersonalStudyRoom, ROOM_BOARD_CLEARANCE, STUDY_ROOM, STUDY_ROOM_MAX_DISTANCE,
  STUDY_WINDOW_LIGHT, studyRoomFrame, studyRoomLighting,
} from '../src/three/environments/studyRoomLayout.ts'
import { buildStudyRoom } from '../src/three/environments/studyRoomModel.ts'
import { createStudyPlasterBox, STUDY_BOARD_THICKNESS, STUDY_WALL_FACE } from '../src/three/environments/studyRoomMaterials.ts'
import { createPaperGeometry, PAPER_SHAPE_COUNT } from '../src/three/paperGeometry.ts'
import { noteLayerDepth } from '../src/three/noteLayers.ts'
import { getPickupLift } from '../src/three/paperMotion.ts'

test('the room uses the existing default theme ID and a neutral daylight palette', () => {
  assert.equal(DEFAULT_APPEARANCE.theme, 'minimal')
  assert.deepEqual(Object.keys(THEME_PRESETS).filter((id) => isPersonalStudyRoom(id as keyof typeof THEME_PRESETS)), ['minimal'])
  assert.equal(THEME_PRESETS.minimal.name, 'Personal Study Room')
  assert.equal(wallFinish(DEFAULT_APPEARANCE).color, '#f6eee2')
  const daylight = studyRoomLighting(DEFAULT_APPEARANCE, 'daylight')
  assert.equal(daylight.ambientColor, '#fff8ef')
  assert.equal(daylight.keyColor, '#fcfdff')
  assert.equal(studyRoomLighting(DEFAULT_APPEARANCE, 'warm').keyColor, '#fff3e6')
  assert.ok(studyRoomLighting({ ...DEFAULT_APPEARANCE, intensity: 115 }, 'daylight').key > daylight.key)
})

test('the off-white plaster aligns across the board edge without moving the note plane', () => {
  const board = createStudyPlasterBox(WALL_WIDTH, WALL_HEIGHT, STUDY_BOARD_THICKNESS)
  const wall = createStudyPlasterBox(18, WALL_HEIGHT, 2, WALL_WIDTH / 2 + 9, 0, STUDY_WALL_FACE - 1)
  function frontEdge(geometry: typeof board, x: number) {
    const { position, normal, uv } = geometry.attributes
    for (let i = 0; i < position.count; i++) {
      if (normal.getZ(i) === 1 && position.getX(i) === x && position.getY(i) === WALL_HEIGHT / 2) {
        return [uv.getX(i), uv.getY(i)]
      }
    }
    assert.fail('Expected an upper front corner')
  }
  assert.deepEqual(frontEdge(board, WALL_WIDTH / 2), frontEdge(wall, -9))
  board.computeBoundingBox()
  const front = board.boundingBox!.max.z - STUDY_BOARD_THICKNESS / 2
  assert.ok(Math.abs(front) < 1e-8)
  const rearGap = STUDY_BOARD_THICKNESS * -1 - STUDY_WALL_FACE
  assert.ok(rearGap > 0 && rearGap < 0.05)
  board.dispose()
  wall.dispose()
})

test('landscape home framing contains the complete board, window, bookshelf, and desk', () => {
  const { window, shelf, desk, floor } = STUDY_ROOM
  const essentials = [
    { left: -WALL_WIDTH / 2, right: WALL_WIDTH / 2, bottom: -WALL_HEIGHT / 2, top: WALL_HEIGHT / 2, front: 0 },
    { ...window, left: window.left - 0.4, right: window.right + 0.4, front: 0.35 },
    { ...shelf, bottom: floor },
    { ...desk, top: desk.surface, bottom: floor },
  ]
  for (const [width, height] of [[1536, 1024], [1440, 900], [1280, 720], [1024, 768], [800, 640], [1720, 720]]) {
    const { x, y, distance } = studyRoomFrame(width, height)!
    assert.ok(distance > MAX_CAMERA_DISTANCE && distance <= STUDY_ROOM_MAX_DISTANCE)
    const camera = new PerspectiveCamera(38, width / height, 0.1, 110)
    camera.position.set(x, y, distance)
    camera.updateMatrixWorld()
    for (const { left, right, top, bottom, front } of essentials) {
      for (const [worldX, worldY] of [[left, top], [right, bottom]]) {
        const point = new Vector3(worldX, worldY, front).project(camera)
        assert.ok(Math.abs(point.x) <= 0.97 && Math.abs(point.y) <= 0.97,
          `cropped at ${width}×${height}: ${[worldX, worldY, front].join(', ')}`)
      }
    }
  }
  assert.equal(studyRoomFrame(390, 844), null)
  assert.equal(studyRoomFrame(768, 1024), null)
  assert.equal(studyRoomFrame(851, 393), null)
})

test('the approved landscape sizes keep the board dominant and the floor below the desk framing', () => {
  for (const [width, height] of [[1536, 1024], [1440, 900]]) {
    const { x, y, distance } = studyRoomFrame(width, height)!
    const camera = new PerspectiveCamera(38, width / height, 0.1, 110)
    camera.position.set(x, y, distance)
    camera.updateMatrixWorld()
    const left = new Vector3(-WALL_WIDTH / 2, 0, 0).project(camera)
    const right = new Vector3(WALL_WIDTH / 2, 0, 0).project(camera)
    const boardWidthFraction = (right.x - left.x) / 2
    assert.ok(boardWidthFraction >= 0.515 && boardWidthFraction <= 0.555)
    assert.ok((1 - new Vector3(0, STUDY_ROOM.floor, 0).project(camera).y) / 2 > 0.93)
  }
})

test('the compact home frame fits 37 saved notes around safe areas on phone and tablet', () => {
  const notes: StickyNoteData[] = Array.from({ length: 37 }, (_, i) => ({
    ...SAMPLE_NOTES[0], id: `layout-${i}`, position: [-12.8 + (i % 10) * 2.77, 8.1 - Math.floor(i / 10) * 5.25],
    rotation: (i % 3 - 1) * 0.06,
  }))
  const original = structuredClone(notes)
  for (const [width, height] of [[393, 851], [768, 1024]]) {
    const insets = { top: 142, bottom: 216, left: 18, right: 14 }
    for (const rotation of [[0, 0], [22, -28]] satisfies Point2[]) {
      const frame = compactStudyFrame(width, height, notes, rotation, insets)
      assert.ok(frame.maxDistance >= frame.distance)
      const board = new Group()
      board.rotation.set(MathUtils.degToRad(rotation[0]), MathUtils.degToRad(rotation[1]), 0)
      const camera = new PerspectiveCamera(38, width / height, 0.1, frame.maxDistance + 52)
      const target = new Vector3(frame.x, frame.y, 0)
      camera.position.set(frame.x, frame.y, frame.distance)
      constrainWallView(board, target, camera.position, width / height)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      for (const note of notes) {
        const [w, h] = getNoteSize(note)
        for (const x of [-w / 2, w / 2]) for (const y of [-h / 2, h / 2]) {
          const point = new Vector3(x, y, 0.2).applyEuler(new Euler(0, 0, note.rotation))
          point.x += note.position[0]
          point.y += note.position[1]
          point.applyEuler(board.rotation).project(camera)
          const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2
          assert.ok(px >= insets.left && px <= width - insets.right && py >= insets.top && py <= height - insets.bottom)
        }
      }
    }
  }
  assert.deepEqual(notes, original)
})

test('sparse compact walls stay closer and ignore archived notes when resetting the camera', () => {
  const note = { ...SAMPLE_NOTES[0], position: [4, 2] as Point2 }
  const archived = { ...SAMPLE_NOTES[1], position: [-12, -8] as Point2, archived: true }
  const frame = compactStudyFrame(393, 851, [note, archived], [0, 0], { top: 112, bottom: 198, left: 14, right: 14 })
  assert.ok(frame.distance < MAX_CAMERA_DISTANCE)
  assert.equal(frame.x, 4)
  assert.ok(frame.y < note.position[1])
})

test('the window light projects onto the lower-left wall and desk with upper-right room for ambient light', () => {
  const light = new SpotLight('#fff', 1, STUDY_WINDOW_LIGHT.range, STUDY_WINDOW_LIGHT.angle)
  light.position.set(...STUDY_WINDOW_LIGHT.position)
  light.target.position.set(...STUDY_WINDOW_LIGHT.target)
  light.updateMatrixWorld()
  light.target.updateMatrixWorld()
  light.shadow.updateMatrices(light)
  const [onWall, onDesk, upperRight] = [
    new Vector3(-12, -5, 0), new Vector3(-10, STUDY_ROOM.desk.surface, 3), new Vector3(12, 6, 0),
  ].map((point) => point.applyMatrix4(light.shadow.matrix))
  assert.ok(onWall.x > 66 / 128 && onWall.x < 103 / 128 && onWall.y > 69 / 128 && onWall.y < 110 / 128)
  assert.ok(onDesk.x > 66 / 128 && onDesk.x < 103 / 128 && onDesk.y > 18 / 128 && onDesk.y < 63 / 128)
  assert.ok(upperRight.x > 1)
  light.dispose()
})

test('the stationary room builds finite batched geometry without participating in note raycasts', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const canvas = {
    getContext() {
      return {
        createImageData: (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
        putImageData() {}, fillRect() {},
        createLinearGradient: () => ({ addColorStop() {} }),
      }
    },
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => canvas } })
  const plaster = new Texture()
  const { planes } = createBoardCutaway()
  try {
    const model = buildStudyRoom(planes, plaster)
    try {
      for (const name of ['recessed glass pane', 'distant trees through the window', 'oak desk and bookcase',
        'cloth, leather and paper book covers', 'staggered oak floorboards', 'pothos on the sill and bookshelf',
        'plaster above the portrait workspace']) {
        assert.ok(model.room.getObjectByName(name), name)
      }
      assert.equal(model.room.getObjectByName('foreground chair'), undefined)
      let drawMeshes = 0
      model.room.traverse((object) => {
        if (!(object instanceof Mesh)) return
        drawMeshes++
        assert.ok(object.geometry.attributes.position.array.every(Number.isFinite), object.name)
        assert.equal(object.material.clippingPlanes, planes, object.name)
      })
      assert.ok(drawMeshes <= 27, `unexpected room mesh count: ${drawMeshes}`)
      model.room.updateMatrixWorld(true)
      const ray = new Raycaster(new Vector3(-22, 0, 60), new Vector3(0, 0, -1))
      assert.deepEqual(ray.intersectObject(model.room), [])
    } finally {
      model.dispose()
    }
  } finally {
    plaster.dispose()
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('the cutaway contains the deepest lifted paper and resize handles', () => {
  const depth = noteLayerDepth(MAX_NOTES - 1)
  for (let variant = 0; variant < PAPER_SHAPE_COUNT; variant++) {
    const geometry = createPaperGeometry(variant)
    geometry.computeBoundingBox()
    assert.ok(depth + getPickupLift(depth) + geometry.boundingBox!.max.z < ROOM_BOARD_CLEARANCE)
    geometry.dispose()
  }
  assert.ok(depth + 0.14 < ROOM_BOARD_CLEARANCE)
})

test('rotated boards remain unobstructed during constrained orbit and at zoom extremes', () => {
  const board = new Group()
  const cutaway = createBoardCutaway()
  const discarded = (point: Vector3) => cutaway.planes.every((plane) => plane.distanceToPoint(point) < 0)
  const edge = new Vector3()
  const world = new Vector3()
  for (const aspect of [390 / 844, 1440 / 900]) {
    for (const tilt of [-25, 0, 25]) {
      for (const turn of [-30, 0, 30]) {
        board.rotation.set(MathUtils.degToRad(tilt), MathUtils.degToRad(turn), 0)
        for (const side of [-1, 1]) {
          for (const distance of [MIN_CAMERA_DISTANCE, MAX_CAMERA_DISTANCE, STUDY_ROOM_MAX_DISTANCE]) {
            const target = new Vector3(side * 9, -side * 5, -3)
            const eye = new Vector3(side * 0.8, -0.5, 0.52).setLength(distance).add(target)
            constrainWallView(board, target, eye, aspect)
            cutaway.update(board, eye)
            for (const x of [-WALL_WIDTH / 2, 0, WALL_WIDTH / 2]) {
              for (const y of [-WALL_HEIGHT / 2, WALL_HEIGHT / 2]) {
                for (const z of [0, ROOM_BOARD_CLEARANCE]) {
                  const paper = board.localToWorld(edge.set(x, y, z))
                  for (const towardPaper of [0.1, 0.5, 0.997]) {
                    assert.ok(discarded(world.lerpVectors(eye, paper, towardPaper)), `view blocked at ${tilt}°, ${turn}°, distance ${distance}`)
                  }
                }
              }
            }
            assert.ok(!discarded(board.localToWorld(world.set(0, 0, -0.85))), 'rear plaster remains visible behind the board')
          }
        }
      }
    }
  }
})

test('furniture outside the protected view remains visible, with a safe fallback close to the board', () => {
  const board = new Group()
  const cutaway = createBoardCutaway()
  const point = new Vector3()
  const discarded = (x: number, y: number, z: number) => cutaway.planes.every((plane) => plane.distanceToPoint(point.set(x, y, z)) < 0)
  cutaway.update(board, new Vector3(0, -3.15, 36))
  assert.equal(discarded(0, -13.02, 3.06), false, 'desk outside the board silhouette')
  assert.equal(discarded(-19, 0, -1.2), false, 'window beside the board')
  assert.equal(discarded(0, 0, 1), true, 'foreground geometry in front of a note')
  cutaway.update(board, new Vector3(12, 0, 0.2))
  assert.equal(discarded(20, 0, 0.1), true)
  assert.equal(discarded(20, 0, -0.1), false)
})
