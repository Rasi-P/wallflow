import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createPaperGeometry, paperShapeForId, PAPER_SHAPE_COUNT } from '../src/three/paperGeometry.ts'
import { getPickupLift, stepPaperLift } from '../src/three/paperMotion.ts'
import { noteLayerDepth } from '../src/three/noteLayers.ts'
import { paintNoteInk } from '../src/three/textures.ts'
import { SAMPLE_NOTES } from '../src/utils/constants.ts'

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

test('larger mobile lettering stays inside the paper and above the task summary', () => {
  const lines: Array<{ text: string; x: number; y: number; width: number; font: string }> = []
  const boxes: number[] = []
  const context = {
    font: '',
    measureText(text: string) { return { width: Array.from(text).length * (Number(/(\d+)px/.exec(this.font)?.[1]) || 90) * 0.55 } },
    fillText(text: string, x: number, y: number, width: number) { lines.push({ text, x, y, width, font: this.font }) },
    strokeRect(_x: number, y: number) { boxes.push(y) },
  } as unknown as CanvasRenderingContext2D
  paintNoteInk(context, {
    phone: true, largerInk: true, title: 'Plan lessons', body: 'Research notes '.repeat(16),
    task: { rows: Array.from({ length: 3 }, () => ({ text: 'Review the long step '.repeat(4), done: false })),
      summary: '0/3 checked', due: 'Due Wed', overdue: false },
  }, '#333')
  assert.match(lines[0].font, /124px/)
  assert.equal(boxes.length, 3)
  const summary = lines.find(({ text }) => text === '0/3 checked')!
  assert.ok(lines.filter(({ text }) => text.startsWith('Review')).every(({ y, text }) => y < summary.y && text.endsWith('…')))
  assert.ok(lines.every(({ x, width, y }) => x + width <= 924 && y < 1024))
})
