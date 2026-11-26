import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { createPaperGeometry, paperShapeForId, PAPER_SHAPE_COUNT } from '../src/three/paperGeometry.ts'
import { getPickupLift, stepPaperLift } from '../src/three/paperMotion.ts'
import { noteLayerDepth } from '../src/three/noteLayers.ts'
import { getStarterFrame } from '../src/three/starterFrame.ts'
import { paintNoteInk } from '../src/three/textures.ts'
import { SAMPLE_NOTES } from '../src/utils/constants.ts'

test('all seven starter notes fit between the welcome and toolbar at common screen sizes', () => {
  const geometry = createPaperGeometry()
  const vertices = geometry.attributes.position
  for (const [width, height] of [[1920, 1080], [1440, 900], [1280, 720], [768, 1024], [390, 844], [320, 568], [844, 390], [568, 320]]) {
    const frame = getStarterFrame(width, height)
    const camera = new PerspectiveCamera(38, width / height, 0.1, 110)
    camera.position.set(frame.x, frame.y, frame.distance)
    camera.updateMatrixWorld()
    const point = new Vector3()
    for (const [index, note] of SAMPLE_NOTES.entries()) {
      const c = Math.cos(note.rotation), s = Math.sin(note.rotation)
      for (let i = 0; i < vertices.count; i++) {
        const x = vertices.getX(i), y = vertices.getY(i)
        point.set(c * x - s * y + note.position[0], s * x + c * y + note.position[1], vertices.getZ(i) + noteLayerDepth(index)).project(camera)
        const screenX = (point.x + 1) * width / 2, screenY = (1 - point.y) * height / 2
        assert.ok(screenX >= frame.side && screenX <= width - frame.side && screenY >= frame.top && screenY <= height - frame.bottom,
          `${note.id} at ${width}×${height}`)
      }
    }
  }
  geometry.dispose()
})

test('paper lift and release settle monotonically and honor reduced motion', () => {
  const height = getPickupLift(noteLayerDepth(0))
  let lift = 0
  for (let frame = 0; frame < 30; frame++) {
    const next = stepPaperLift(lift, height, 1 / 60, false)
    assert.ok(next >= lift && next <= height)
    lift = next
  }
  assert.equal(lift, height)
  for (let frame = 0; frame < 30; frame++) {
    const next = stepPaperLift(lift, 0, 1 / 60, false)
    assert.ok(next <= lift && next >= 0)
    lift = next
  }
  assert.equal(lift, 0)
  assert.equal(stepPaperLift(0, height, 1 / 60, true), height)
  assert.equal(stepPaperLift(height, 0, 1 / 60, true), 0)
})

test('notes select stable paper shapes with a flat adhesive edge and distinct bottom curls', () => {
  const ids = SAMPLE_NOTES.map(({ id }) => id)
  const variants = ids.map(paperShapeForId)
  assert.deepEqual(ids.toReversed().map(paperShapeForId).toReversed(), variants)
  assert.equal(new Set(variants).size, PAPER_SHAPE_COUNT)

  const curlSizes = []
  for (let index = 0; index < PAPER_SHAPE_COUNT; index++) {
    const geometry = createPaperGeometry(index)
    const position = geometry.attributes.position
    const firstBottomVertex = (24 + 1) * 28
    assert.ok(Math.abs(position.getZ(0)) < 1e-8)
    assert.ok(Math.abs(position.getZ(24)) < 1e-8)
    curlSizes.push(position.getZ(firstBottomVertex) - position.getZ(firstBottomVertex + 24))
    geometry.dispose()
  }
  assert.ok(curlSizes[0] < 0 && curlSizes[1] > 0)
  assert.equal(new Set(curlSizes).size, PAPER_SHAPE_COUNT)
})

test('long writing stays within the shared text layout for both renderers', () => {
  const lines: Array<{ text: string; x: number; y: number; width: number }> = []
  const context = {
    measureText: (text: string) => ({ width: Array.from(text).length * 37 }),
    fillText: (text: string, x: number, y: number, width: number) => { lines.push({ text, x, y, width }) },
  } as unknown as CanvasRenderingContext2D
  paintNoteInk(context, { title: '📌'.repeat(36), body: 'Research '.repeat(24) }, '#fff')
  assert.ok(lines.some(({ text }) => text.endsWith('…')))
  assert.ok(lines.every(({ x, y, width }) => x >= 100 && x + width <= 924 && y <= 846))
  assert.ok(lines.every(({ text }) => !/[\uD800-\uDFFF]/u.test(text)))
})
