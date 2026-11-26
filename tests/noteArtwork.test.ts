import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MeshStandardMaterial } from 'three'
import { createWorkspaceStore } from '../src/stores/workspaceStore.ts'
import { FIRST_BOARD_ID, LEGACY_WALL_STORAGE_KEY } from '../src/stores/workspaceStorage.ts'
import { getEditorKeyAction } from '../src/utils/noteEditorKeys.ts'
import { EMOJI_CATEGORIES, NOTE_EMOJIS, containsEmoji } from '../src/utils/noteEmoji.ts'
import { inlineNoteParts, insertNoteText, limitNoteText, matchesNoteArtwork, moveArtworkFocus, sketchMarker } from '../src/utils/noteText.ts'
import { isSketchId, SKETCH_CATEGORIES, SKETCHES, SKETCH_IDS } from '../src/utils/sketches.ts'
import { SAMPLE_NOTES } from '../src/utils/constants.ts'
import { NOTE_BODY_FONT, NOTE_TITLE_FONTS } from '../src/utils/appearance.ts'
import { keepColorEmoji } from '../src/three/noteSurface.ts'
import type { BindNoteSurface } from '../src/three/noteSurface.ts'
import { paintNoteInk } from '../src/three/textures.ts'

const scientist = '🧑🏽‍🔬'

test('both picker catalogs cover the categories and search by related words', () => {
  assert.deepEqual(new Set(SKETCH_IDS.map((id) => SKETCHES[id].category)), new Set(SKETCH_CATEGORIES))
  assert.deepEqual(new Set(NOTE_EMOJIS.map(({ category }) => category)), new Set(EMOJI_CATEGORIES))
  assert.equal(SKETCH_IDS.length, 35)
  assert.ok(SKETCH_IDS.every((id) => SKETCHES[id].outline.startsWith('M') && SKETCHES[id].detail.startsWith('M')))
  assert.ok(matchesNoteArtwork(SKETCHES.flask, 'lab chemistry'))
  assert.ok(NOTE_EMOJIS.some((emoji) => matchesNoteArtwork(emoji, 'clover luck')))
  assert.ok(!isSketchId('constructor'))
  assert.equal(moveArtworkFocus('ArrowDown', 1, 9, 4), 5)
  assert.equal(moveArtworkFocus('ArrowRight', 8, 9, 4), 8)
  assert.equal(moveArtworkFocus('Home', 5, 9, 4), 0)
  assert.equal(moveArtworkFocus('Tab', 0, 9, 4), null)
})

test('native Unicode composition and cursor insertion preserve whole emoji and the surrounding text', () => {
  assert.deepEqual(insertNoteText('Read today', 5, 5, scientist, 72), { value: `Read ${scientist}today`, cursor: 5 + scientist.length })
  assert.deepEqual(insertNoteText('Line one\nNotes', 9, 14, '📚', 240), { value: 'Line one\n📚', cursor: 11 })
  assert.equal(insertNoteText('Full title', 4, 4, scientist, 12), null)
  assert.equal(limitNoteText(`abc${scientist}d`, 5), 'abc')
  assert.equal(limitNoteText(`abc${scientist}d`, 3 + scientist.length), `abc${scientist}`)
  assert.equal(getEditorKeyAction({ key: 'Enter', isComposing: true, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }), null)
  assert.ok(containsEmoji(scientist) && containsEmoji('🇨🇦') && containsEmoji('3️⃣'))
  assert.match(NOTE_TITLE_FONTS.handwritten, /Noteworthy.*Apple Color Emoji/)
  assert.match(NOTE_BODY_FONT, /Segoe UI Emoji.*Noto Color Emoji/)
})

test('inline sketches tokenize only valid catalog entries', () => {
  const marker = sketchMarker('open-book')
  assert.deepEqual(inlineNoteParts(`Read ${marker} now [[sketch:unknown]]`), ['Read ', { sketch: 'open-book' }, ' now [[sketch:unknown]]'])
  assert.deepEqual(insertNoteText('a b', 2, 2, marker, 72), { value: `a ${marker}b`, cursor: 2 + marker.length })
})

test('emoji, sketches and legacy notes survive reload, board switches and the existing edit history', () => {
  const original = { ...SAMPLE_NOTES[0], doodle: 'leaf' as const }
  const untouched = { ...SAMPLE_NOTES[1], title: 'Literal [[sketch:open-book]]' }
  const legacy = JSON.stringify({ version: 1, state: { notes: [original, untouched] } })
  const memory = new Map([[LEGACY_WALL_STORAGE_KEY, legacy]])
  const storage = { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => { memory.set(key, value) } }
  const workspace = createWorkspaceStore(storage)
  const before = workspace.wall.getState().notes[0]
  const id = before.id
  const other = workspace.createBoard('Separate board')!
  const actions = workspace.wall.getState()
  actions.editNote(id)
  actions.writeNoteText(id, { title: `Read ${scientist}`, body: `First line\n${sketchMarker('open-book')} 📚`, inlineSketches: true })
  actions.setNoteDoodle(id, 'microscope')
  actions.finishEditing()
  const revised = workspace.wall.getState().notes[0]
  assert.deepEqual(revised.position, before.position)
  assert.equal(revised.rotation, before.rotation)
  assert.equal(revised.title, `Read ${scientist}`)
  actions.undo()
  assert.deepEqual(workspace.wall.getState().notes[0], before)
  actions.redo()
  assert.deepEqual(workspace.wall.getState().notes[0], revised)
  workspace.switchBoard(other)
  assert.deepEqual(workspace.wall.getState().notes, [])
  const refreshed = createWorkspaceStore(storage)
  refreshed.switchBoard(FIRST_BOARD_ID)
  assert.deepEqual(refreshed.wall.getState().notes, [revised, untouched])
  refreshed.wall.getState().editNote(id)
  refreshed.wall.getState().setNoteDoodle(id)
  refreshed.wall.getState().finishEditing()
  assert.equal(refreshed.wall.getState().notes[0].doodle, undefined)
  refreshed.wall.getState().undo()
  assert.equal(refreshed.wall.getState().notes[0].doodle, 'microscope')
  assert.equal(memory.get(LEGACY_WALL_STORAGE_KEY), legacy)
})

test('the optional monochrome renderer falls back per note for color emoji', () => {
  const applied: string[] = []
  const renderer = (name: string): BindNoteSurface => () => ({
    update: () => { applied.push(name) }, dispose: () => { applied.push(`dispose ${name}`) },
  })
  const material = new MeshStandardMaterial()
  const surface = keepColorEmoji(renderer('ink'), renderer('baked'))(material)
  surface.update(SAMPLE_NOTES[0])
  surface.update({ ...SAMPLE_NOTES[0], body: scientist })
  surface.update({ ...SAMPLE_NOTES[0], title: '🧪' })
  surface.update(SAMPLE_NOTES[0])
  surface.dispose()
  material.dispose()
  assert.deepEqual(applied, ['ink', 'dispose ink', 'baked', 'baked', 'dispose baked', 'ink', 'dispose ink'])
})

test('the wall draws inline and corner SVG paths with room for resized checklist notes', (t) => {
  const pathDefinition = Object.getOwnPropertyDescriptor(globalThis, 'Path2D')
  Object.defineProperty(globalThis, 'Path2D', { configurable: true, value: class {
    data: string
    constructor(data: string) { this.data = data }
  } })
  t.after(() => {
    if (pathDefinition) Object.defineProperty(globalThis, 'Path2D', pathDefinition)
    else Reflect.deleteProperty(globalThis, 'Path2D')
  })
  const strokes: string[] = []
  const text: { value: string; x: number; y: number; width?: number }[] = []
  const placements: number[][] = []
  const scales: number[][] = []
  const ctx = {
    measureText: (value: string) => ({ width: value.length * 28 }),
    fillText: (value: string, x: number, y: number, width?: number) => text.push({ value, x, y, width }),
    stroke: (path: { data: string }) => strokes.push(path.data),
    save() {}, restore() {}, strokeRect() {},
    translate: (...args: number[]) => placements.push(args),
    scale: (...args: number[]) => scales.push(args),
  } as unknown as CanvasRenderingContext2D
  const marker = sketchMarker('open-book')
  paintNoteInk(ctx, { title: marker, body: '', doodle: undefined }, '#473826')
  assert.ok(text.some((line) => line.value === marker))
  assert.equal(strokes.length, 0)
  text.length = 0
  paintNoteInk(ctx, {
    title: 'Read and review',
    body: `Read ${marker} today`,
    doodle: 'flask',
    inlineSketches: true,
    sketchAspect: 2.4,
    task: { rows: Array.from({ length: 3 }, () => ({ text: 'Long checklist item that wraps past the available width', done: false })), summary: '0/3 complete' },
  }, '#473826')
  assert.ok(strokes.includes(SKETCHES['open-book'].outline) && strokes.includes(SKETCHES.flask.outline))
  assert.ok(text.every((line) => !line.value.includes('[[sketch:')))
  const rows = text.filter(({ x }) => x === 160)
  const [cornerX, cornerY] = placements.at(-2)!
  assert.equal(rows.length, 3)
  assert.ok(rows[0].y < rows[1].y && rows[1].y < rows[2].y)
  for (const row of rows) {
    assert.ok(row.y + 14 < cornerY || row.x + row.width! < cornerX)
  }
  const [scaleX, scaleY] = scales.at(-1)!
  assert.ok(Math.abs(scaleX * 2.4 - scaleY) < 1e-10)
})
