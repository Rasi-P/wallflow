import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, Mesh, Vector3 } from 'three'
import { createPaperGeometry } from '../src/three/paperGeometry.ts'
import { MAX_NOTES, NOTE_HEIGHT, NOTE_WIDTH, SAMPLE_NOTES } from '../src/utils/constants.ts'
import { LEGACY_WALL_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from '../src/stores/workspaceStorage.ts'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
  removeItem: (key: string) => { memory.delete(key) },
} })
const { useWallStore: store, workspace, clampPosition } = await import('../src/stores/wallStore.ts')

beforeEach(() => {
  memory.clear()
  workspace.reload()
})

const sampleId = SAMPLE_NOTES[0].id

test('a completed drag is one reversible action', () => {
  store.getState().updateNote(sampleId, { position: [4, 3] })
  assert.equal(store.getState().past.length, 1)
  assert.deepEqual(store.getState().notes[0].position, [4, 3])
  store.getState().undo()
  assert.deepEqual(store.getState().notes[0].position, SAMPLE_NOTES[0].position)
  store.getState().redo()
  assert.deepEqual(store.getState().notes[0].position, [4, 3])
})

test('a new edit after undo clears the redo branch', () => {
  store.getState().updateNote(sampleId, { title: 'First version' })
  store.getState().undo()
  store.getState().updateNote(sampleId, { title: 'A different idea' })
  assert.equal(store.getState().future.length, 0)
  store.getState().redo()
  assert.equal(store.getState().notes[0].title, 'A different idea')
})

test('adding, coloring and deleting a note can all be undone', () => {
  store.getState().chooseColor('pink')
  store.getState().addNote()
  const id = store.getState().selectedId!
  assert.equal(store.getState().notes.at(-1)?.color, 'pink')
  store.getState().chooseColor('green')
  assert.equal(store.getState().notes.at(-1)?.color, 'green')
  store.getState().deleteNote(id)
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length)
  store.getState().undo()
  assert.equal(store.getState().notes.at(-1)?.color, 'green')
  store.getState().undo()
  assert.equal(store.getState().notes.at(-1)?.color, 'pink')
  store.getState().undo()
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length)
})

test('wall rotation does not change stored note positions and is undoable', () => {
  const positions = store.getState().notes.map((note) => note.position)
  store.getState().rotateWall([15, -20])
  assert.deepEqual(store.getState().notes.map((note) => note.position), positions)
  assert.deepEqual(store.getState().wallRotation, [15, -20])
  store.getState().undo()
  assert.deepEqual(store.getState().wallRotation, [0, 0])
})

test('notes are bounded by the physical wall and have a finite limit', () => {
  const [x, y] = clampPosition([1000, -1000])
  assert.ok(x < 16 && x > 0 && y > -11 && y < 0)
  for (let i = 0; i < MAX_NOTES + 2; i++) {
    store.getState().addNote()
    store.getState().finishEditing()
  }
  assert.equal(store.getState().notes.length, MAX_NOTES)
})

test('persistence stores durable wall data without UI state or history', () => {
  store.getState().select(sampleId)
  store.getState().rotateWall([10, 5])
  const saved = JSON.parse(memory.get(WORKSPACE_STORAGE_KEY)!).boards[workspace.getState().activeBoardId]
  assert.equal(saved.document.notes.length, SAMPLE_NOTES.length)
  assert.deepEqual(saved.document.wallRotation, [10, 5])
  assert.equal(saved.selectedId, undefined)
  assert.equal(saved.past, undefined)
})

test('camera and selection changes do not serialize a 60-note wall', (t) => {
  const notes = Array.from({ length: MAX_NOTES }, (_, index) => ({ ...SAMPLE_NOTES[0], id: `note-${index}` }))
  store.setState({ notes })
  const write = t.mock.method(localStorage, 'setItem')
  const { setZoomPercent, select, setDragging, updateNote } = store.getState()
  for (let i = 0; i < 120; i++) setZoomPercent(i)
  select(notes[0].id)
  setDragging(notes[0].id)
  setDragging(null)
  assert.equal(write.mock.callCount(), 0)
  assert.equal(store.getState().notes, notes)
  updateNote(notes[0].id, { title: 'A saved change' })
  assert.equal(write.mock.callCount(), 1)
  assert.equal(store.getState().notes[1], notes[1])
})

test('refresh restores note text, position, rotation and color', () => {
  const id = SAMPLE_NOTES[0].id
  const changes = { title: 'Updated title', body: 'Keep this reminder.', position: [3, -4] as [number, number], color: 'violet' as const }
  store.getState().updateNote(id, changes)
  store.getState().rotateWall([15, -20])
  workspace.reload()

  assert.deepEqual(store.getState().notes[0], { ...SAMPLE_NOTES[0], ...changes })
  assert.deepEqual(store.getState().wallRotation, [15, -20])
  assert.deepEqual(store.getState().past, [])
})

test('corrupt storage keeps valid notes and cannot overwrite store actions', () => {
  const note = SAMPLE_NOTES[0]
  memory.set(LEGACY_WALL_STORAGE_KEY, JSON.stringify({ version: 1, state: {
    notes: [null, { ...note, id: 'invalid-color', color: 'toString' }, { ...note, id: 'invalid-position', position: [1, null] }, note, { ...note, title: 'Duplicate' }],
    wallRotation: [500, -200], wallName: {}, lighting: 'unknown', addNote: null,
  } }))

  workspace.reload()

  assert.deepEqual(store.getState().notes, [note])
  assert.deepEqual(store.getState().wallRotation, [25, -30])
  assert.equal(store.getState().wallName, 'My everyday wall')
  assert.equal(store.getState().lighting, 'daylight')
  assert.equal(typeof store.getState().addNote, 'function')
})

test('invalid JSON and an invalid note collection leave a usable wall', () => {
  for (const contents of ['{broken', JSON.stringify({ version: 1, state: { notes: null } })]) {
    memory.set(LEGACY_WALL_STORAGE_KEY, contents)
    workspace.reload()
    assert.deepEqual(store.getState().notes, SAMPLE_NOTES)
  }
  store.getState().addNote()
  assert.equal(store.getState().notes.length, SAMPLE_NOTES.length + 1)
})

test('an intentionally empty wall remains empty after refresh', () => {
  memory.set(LEGACY_WALL_STORAGE_KEY, JSON.stringify({ version: 1, state: { notes: [] } }))
  workspace.reload()
  assert.deepEqual(store.getState().notes, [])
})

test('dismissing the welcome survives refresh without changing notes or history', () => {
  const notes = store.getState().notes
  assert.equal(store.getState().onboardingComplete, false)
  store.getState().completeOnboarding({ starter: 'samples', offerTutorial: false })
  assert.equal(store.getState().notes, notes)
  assert.equal(store.getState().past.length, 0)
  workspace.reload()
  assert.equal(store.getState().onboardingComplete, true)
  assert.deepEqual(store.getState().notes, notes)
})

test('returning users retain their old notes instead of getting the new starter wall', () => {
  const oldNote = { ...SAMPLE_NOTES[0], id: 'a-little-focus', title: 'My own weekly plan', position: [4, 2] }
  memory.set(LEGACY_WALL_STORAGE_KEY, JSON.stringify({ version: 1, state: { notes: [oldNote] } }))
  workspace.reload()
  assert.deepEqual(store.getState().notes, [oldNote])
  assert.equal(store.getState().onboardingComplete, true)
})

test('the first new note has room beside the starter notes', () => {
  store.getState().addNote()
  const [x, y] = store.getState().notes.at(-1)!.position
  for (const note of SAMPLE_NOTES) {
    assert.ok(Math.abs(x - note.position[0]) > NOTE_WIDTH || Math.abs(y - note.position[1]) > NOTE_HEIGHT)
  }
})

test('3D paper lifts at the bottom and follows a rotated parent wall', () => {
  const geometry = createPaperGeometry()
  const vertices = geometry.attributes.position
  const bottom: number[] = [], top: number[] = []
  for (let i = 0; i < vertices.count; i++) {
    if (vertices.getY(i) < -NOTE_HEIGHT * 0.49) bottom.push(vertices.getZ(i))
    if (vertices.getY(i) > NOTE_HEIGHT * 0.49) top.push(vertices.getZ(i))
  }
  assert.ok(Math.min(...bottom) > Math.max(...top) + 0.03)
  const wall = new Group(), note = new Mesh(geometry)
  note.position.set(3, 2, 0.035)
  wall.add(note)
  const before = note.getWorldPosition(new Vector3())
  wall.rotation.y = Math.PI / 6
  const after = note.getWorldPosition(new Vector3())
  assert.ok(before.distanceTo(after) > 1)
  assert.deepEqual(note.position.toArray(), [3, 2, 0.035])
  geometry.dispose()
})
