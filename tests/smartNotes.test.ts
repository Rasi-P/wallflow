import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import type { Point2 } from '../src/types/wall.ts'
import { NOTE_HEIGHT, NOTE_WIDTH, SAMPLE_NOTES } from '../src/utils/constants.ts'
import { getNoteSize, resizeFromCorner } from '../src/utils/noteDimensions.ts'
import { getEditorKeyAction } from '../src/utils/noteEditorKeys.ts'
import { visibleWallSlots } from '../src/three/noteProjection.ts'
import { WORKSPACE_STORAGE_KEY } from '../src/stores/workspaceStorage.ts'

const data = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value) },
} })
const { useWallStore: store, workspace, registerVisibleNoteSlots } = await import('../src/stores/wallStore.ts')
const { handleWallShortcut } = await import('../src/hooks/useKeyboardShortcuts.ts')

beforeEach(() => {
  data.clear()
  workspace.reload()
})

test('creation selects and opens the note at the current visible wall center', () => {
  const wall = new Group()
  wall.rotation.y = 0.32
  const target = wall.localToWorld(new Vector3(8, 3, 0))
  const camera = new PerspectiveCamera(38, 390 / 844, 0.1, 110)
  camera.position.copy(target).add(new Vector3(0, 0, 12))
  camera.lookAt(target)
  const resolve = () => visibleWallSlots(camera, wall)
  const [center] = resolve()
  const unregister = registerVisibleNoteSlots(resolve)
  try { store.getState().addNote() } finally { unregister() }
  const { notes, selectedId, editingId } = store.getState()
  const created = notes.at(-1)!
  assert.deepEqual(created.position, center)
  assert.ok(Math.abs(created.position[0] - 8) < 0.1)
  assert.equal(selectedId, created.id)
  assert.equal(editingId, created.id)
  assert.equal(created.title, '')
  assert.equal(notes.length, SAMPLE_NOTES.length + 1)
  assert.equal(JSON.parse(data.get(WORKSPACE_STORAGE_KEY)!).boards[workspace.getState().activeBoardId].document.notes.at(-1).id, created.id)
})

test('live title and description save line breaks with one undo step for an existing note', () => {
  const original = SAMPLE_NOTES[0]
  store.getState().editNote(original.id)
  store.getState().writeNoteText(original.id, { title: 'First line\nSecond line' })
  store.getState().writeNoteText(original.id, { body: 'One\n\nTwo' })
  const updated = store.getState().notes[0]
  assert.deepEqual(JSON.parse(data.get(WORKSPACE_STORAGE_KEY)!).boards[workspace.getState().activeBoardId].document.notes[0], updated)
  assert.equal(updated.title, 'First line\nSecond line')
  assert.equal(updated.body, 'One\n\nTwo')
  assert.equal(store.getState().past.length, 0)
  store.getState().finishEditing()
  store.getState().finishEditing()
  assert.equal(store.getState().past.length, 1)
  store.getState().undo()
  assert.deepEqual(store.getState().notes[0], original)
  store.getState().redo()
  assert.deepEqual(store.getState().notes[0], updated)
})

test('Escape cancels only an empty new note and restores the previous redo branch', () => {
  const id = SAMPLE_NOTES[0].id
  store.getState().updateNote(id, { title: 'Redo this' })
  store.getState().undo()
  const future = store.getState().future
  store.getState().addNote()
  const emptyId = store.getState().editingId!
  store.getState().writeNoteText(emptyId, { body: ' \n ' })
  store.getState().finishEditing(true)
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length)
  assert.equal(store.getState().selectedId, null)
  assert.equal(store.getState().past.length, 0)
  assert.equal(store.getState().future, future)
  assert.ok(!data.get(WORKSPACE_STORAGE_KEY)?.includes(emptyId))
  store.getState().redo()
  assert.equal(store.getState().notes[0].title, 'Redo this')

  store.getState().addNote()
  const filledId = store.getState().editingId!
  store.getState().writeNoteText(filledId, { title: 'Keep this note' })
  store.getState().finishEditing(true)
  assert.equal(store.getState().notes.at(-1)?.title, 'Keep this note')
  store.getState().undo()
  assert.ok(!store.getState().notes.some((note) => note.id === filledId))
  store.getState().redo()
  assert.equal(store.getState().notes.at(-1)?.title, 'Keep this note')
})

test('proportional resize holds the opposite corner and is reversible', () => {
  const note = SAMPLE_NOTES[0]
  const resized = resizeFromCorner(note, [1, 1], [1.5, 1.8])
  const corner = (position: Point2, size: Point2) => {
    const c = Math.cos(note.rotation), s = Math.sin(note.rotation)
    return [position[0] - (size[0] * c - size[1] * s) / 2, position[1] - (size[0] * s + size[1] * c) / 2]
  }
  const before = corner(note.position, getNoteSize(note))
  const after = corner(resized.position, resized.size)
  assert.ok(Math.hypot(before[0] - after[0], before[1] - after[1]) < 1e-9)
  assert.ok(resized.size[0] > NOTE_WIDTH)
  assert.ok(Math.abs(resized.size[0] / resized.size[1] - NOTE_WIDTH / NOTE_HEIGHT) < 1e-9)
  const min = resizeFromCorner(note, [1, 1], [-900, -900]).size
  assert.ok(min[0] >= NOTE_WIDTH * 0.65 && min[1] >= NOTE_HEIGHT * 0.65)
  store.getState().updateNote(note.id, resized)
  assert.deepEqual(store.getState().notes[0].size, resized.size)
  store.getState().undo()
  assert.deepEqual(store.getState().notes[0], note)
  store.getState().redo()
  assert.deepEqual(store.getState().notes[0], { ...note, ...resized })
})

function press(key: string, overrides: Partial<KeyboardEvent> = {}) {
  let prevented = false
  handleWallShortcut({ key, preventDefault: () => { prevented = true }, ...overrides } as KeyboardEvent)
  return prevented
}

test('creation and Enter repeats never create duplicate notes', () => {
  assert.equal(press('n'), true)
  const editingId = store.getState().editingId!
  press('n', { repeat: true })
  store.getState().addNote()
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length + 1)
  store.getState().writeNoteText(editingId, { title: 'Create once' })
  store.getState().finishEditing()
  for (let i = 0; i < 5; i++) press('Enter', { repeat: true })
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length + 1)
  assert.equal(store.getState().editingId, null)
})

test('shortcut actions work outside inputs and stay out of native text editing', () => {
  const original = SAMPLE_NOTES[0]
  store.getState().select(original.id)
  const input = { tagName: 'TEXTAREA' } as EventTarget
  for (const key of ['n', 'Delete', 'Backspace', 'd', 'z', 'k']) {
    assert.equal(press(key, { target: input, ctrlKey: ['d', 'z', 'k'].includes(key) }), false)
  }
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length)
  assert.equal(press('d', { metaKey: true }), true)
  const copy = store.getState().notes.at(-1)!
  assert.notEqual(copy.id, original.id)
  assert.notDeepEqual(copy.position, original.position)
  assert.deepEqual({ ...copy, id: original.id, position: original.position }, original)
  press('d', { metaKey: true, repeat: true })
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length + 1)
  press('z', { ctrlKey: true })
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length)
  press('z', { ctrlKey: true, shiftKey: true })
  store.getState().select(copy.id)
  assert.equal(press('Backspace'), true)
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length)
  store.getState().select(original.id)
  press('Escape')
  assert.equal(store.getState().selectedId, null)
  press('n')
  press('Escape')
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length)
})

test('the inline editor supports Enter, command Enter, line breaks and IME', () => {
  const event = { key: 'Enter', metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, isComposing: false }
  assert.equal(getEditorKeyAction(event), 'finish')
  assert.equal(getEditorKeyAction({ ...event, metaKey: true }), 'finish')
  assert.equal(getEditorKeyAction({ ...event, ctrlKey: true }), 'finish')
  assert.equal(getEditorKeyAction({ ...event, shiftKey: true }), null)
  assert.equal(getEditorKeyAction({ ...event, isComposing: true }), null)
  assert.equal(getEditorKeyAction({ ...event, key: 'Escape' }), 'cancel-empty')
})

test('refresh preserves a resized note and accepts legacy notes without dimensions', () => {
  const id = SAMPLE_NOTES[0].id
  store.getState().updateNote(id, { size: [3.5, 4], rotation: 0.2, position: [3, -4], color: 'pink' })
  store.getState().editNote(id)
  store.getState().writeNoteText(id, { title: 'Saved while typing', body: 'Line 1\nLine 2' })
  const original = store.getState().notes[0]
  workspace.reload()
  assert.deepEqual(store.getState().notes[0], original)
  assert.equal(store.getState().editingId, null)
  assert.equal(store.getState().notes[1].size, undefined)
  assert.deepEqual(getNoteSize(store.getState().notes[1]), [NOTE_WIDTH, NOTE_HEIGHT])
})
