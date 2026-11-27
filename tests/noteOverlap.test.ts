import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DoubleSide, Mesh, MeshBasicMaterial, OrthographicCamera, Raycaster, Vector3 } from 'three'
import { NOTE_HANDLE_OFFSET, noteLayerDepth, photoNoteLayerDepth } from '../src/three/noteLayers.ts'
import { createPaperGeometry, PAPER_SHAPE_COUNT, paperShapeForId } from '../src/three/paperGeometry.ts'
import { getPickupLift } from '../src/three/paperMotion.ts'
import { NOTE_HEIGHT, NOTE_WIDTH } from '../src/utils/constants.ts'
import { getNoteSize } from '../src/utils/noteDimensions.ts'
import type { Point2, StickyNoteData } from '../src/types/wall.ts'
import { overlapNotes } from './noteOverlapFixtures.ts'

function paperHits(notes: StickyNoteData[], point: Point2, foregroundId?: string, legacyDepth = false) {
  const material = new MeshBasicMaterial({ side: DoubleSide })
  const papers = notes.map((note, index) => {
    const paper = new Mesh(createPaperGeometry(paperShapeForId(note.id)), material)
    const [width, height] = getNoteSize(note)
    paper.name = note.id
    paper.position.set(...note.position, legacyDepth ? noteLayerDepth(index) : photoNoteLayerDepth(index, note.id === foregroundId))
    paper.rotation.z = note.rotation
    paper.scale.set(width / NOTE_WIDTH, height / NOTE_HEIGHT, 1)
    paper.updateMatrixWorld()
    return paper
  })
  try {
    const ray = new Raycaster(new Vector3(...point, 24), new Vector3(0, 0, -1))
    return [...new Set(ray.intersectObjects(papers).map(({ object }) => object.name))]
  } finally {
    for (const paper of papers) paper.geometry.dispose()
    material.dispose()
  }
}

test('a curled rear sheet used to win the overlap hit; the photo depth now picks the top sheet', () => {
  const point: Point2 = [0.45, -0.47]
  const [rear, front] = overlapNotes.partial
  assert.deepEqual(paperHits(overlapNotes.partial, point, undefined, true), [rear.id, front.id])
  assert.deepEqual(paperHits(overlapNotes.partial, point), [front.id, rear.id])
  assert.deepEqual(paperHits(overlapNotes.partial, [-0.9, 0.95]), [rear.id])
})

test('rotated overlaps obey saved order, and selecting an exposed sheet promotes it without editing the fixture', () => {
  const notes = overlapNotes.rotated
  const saved = JSON.stringify(notes)
  const [rear, middle, front] = notes
  assert.deepEqual(paperHits(notes, [0, 0]), [front.id, middle.id, rear.id])
  assert.deepEqual(paperHits(notes, [0, 0], rear.id), [rear.id, front.id, middle.id])
  assert.deepEqual(paperHits(notes, [0, 0]), [front.id, middle.id, rear.id])
  assert.equal(JSON.stringify(notes), saved)
})

test('a nearly coincident front sheet covers the rear ink throughout the shared area', () => {
  for (const x of [-1.1, 0, 1.1]) {
    for (const y of [-1.2, 0, 1.2]) {
      assert.deepEqual(paperHits(overlapNotes.covered, [x, y]), ['overlap-front', 'overlap-rear'])
    }
  }
})

test('the full paper curl fits within its depth layer, with handles above a lifted foreground note', () => {
  let lowest = Infinity, highest = -Infinity
  for (let index = 0; index < PAPER_SHAPE_COUNT; index++) {
    const geometry = createPaperGeometry(index)
    geometry.computeBoundingBox()
    lowest = Math.min(lowest, geometry.boundingBox!.min.z)
    highest = Math.max(highest, geometry.boundingBox!.max.z)
    geometry.dispose()
  }
  assert.ok(photoNoteLayerDepth(0, false) + highest < photoNoteLayerDepth(1, false) + lowest)
  const foreground = photoNoteLayerDepth(0, true)
  assert.ok(highest + getPickupLift(foreground) < NOTE_HANDLE_OFFSET)
  assert.ok(foreground + NOTE_HANDLE_OFFSET < 24 - 0.1)
})

test('the foreground depth keeps desktop and phone paper footprints aligned with the editor anchor', () => {
  for (const [width, height] of [[1440, 900], [393, 851]]) {
    const camera = new OrthographicCamera(-width / 2, width / 2, height / 2, -height / 2, 0.1, 60)
    camera.position.set(1, -2, 24)
    camera.zoom = 54
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    const anchor = new Vector3(0.4, 0.3, 0).project(camera)
    const topPaper = new Vector3(0.4, 0.3, photoNoteLayerDepth(0, true)).project(camera)
    assert.equal(anchor.x, topPaper.x)
    assert.equal(anchor.y, topPaper.y)
  }
})
