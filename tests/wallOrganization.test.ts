import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { Group, PerspectiveCamera, Vector3 } from 'three'
import type { StickyNoteData } from '../src/types/wall.ts'
import { SAMPLE_NOTES } from '../src/utils/constants.ts'
import { DEFAULT_FILTERS, searchNotes } from '../src/utils/noteSearch.ts'
import { MAX_SECTIONS, SECTION_HEIGHT, SECTION_WIDTH, sectionAt } from '../src/utils/wallSections.ts'
import { positionWallFocus, resolveCameraFocus, wallFocusDistance } from '../src/three/cameraFocus.ts'
import { constrainWallView, WALL_CAMERA_FOV } from '../src/three/wallViewBounds.ts'

const key = 'wallflow-wall-v1'
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (name: string) => memory.get(name) ?? null,
  setItem: (name: string, value: string) => { memory.set(name, value) },
} })
const { useWallStore: store, registerVisibleNoteSlots } = await import('../src/stores/wallStore.ts')
const { handleWallShortcut } = await import('../src/hooks/useKeyboardShortcuts.ts')
const [sample, sibling] = SAMPLE_NOTES
const note = (id = sample.id) => store.getState().notes.find((entry) => entry.id === id)!

beforeEach(() => {
  memory.clear()
  store.setState({ ...store.getInitialState(), notes: structuredClone(SAMPLE_NOTES) })
})

test('create, rename and move freely placed sections with undo and redo', () => {
  const { createSection, renameSection, moveSection, undo, redo } = store.getState()
  assert.equal(createSection('  '), undefined)
  const unbind = registerVisibleNoteSlots(() => [[2, 6]])
  const work = createSection('  Work  ')!
  const personal = createSection('Personal')!
  unbind()
  assert.deepEqual(store.getState().sections[0], { id: work, name: 'Work', position: [2, 6] })
  assert.notDeepEqual(store.getState().sections[1].position, [2, 6])
  renameSection(work, 'Current work')
  moveSection(work, [-7.2, 0.4])
  assert.deepEqual(store.getState().sections[0], { id: work, name: 'Current work', position: [-7.2, 0.4] })
  undo()
  assert.deepEqual(store.getState().sections[0].position, [2, 6])
  undo()
  assert.equal(store.getState().sections[0].name, 'Work')
  undo()
  assert.equal(store.getState().sections.length, 1)
  redo()
  assert.equal(store.getState().sections[1].id, personal)
})

test('manual assignment preserves positions and moving a note changes the membership', () => {
  const { createSection, assignSection, updateNote, undo, redo } = store.getState()
  const work = createSection('Work', [-10, 0])!
  const ideas = createSection('Ideas', [10, 0])!
  assignSection(sample.id, work)
  assert.deepEqual(note(), { ...sample, sectionId: work })
  assignSection(sample.id, 'missing')
  assert.equal(note().sectionId, work)
  updateNote(sample.id, { position: [9.1, -1.2] })
  assert.equal(note().sectionId, ideas)
  undo()
  assert.deepEqual(note(), { ...sample, sectionId: work })
  redo()
  assert.equal(note().sectionId, ideas)
  updateNote(sample.id, { position: [0, 0] })
  assert.equal(note().sectionId, undefined)
  assert.deepEqual(note().position, [0, 0])
})

test('section overlap retains membership while inside and chooses the closest section on entry', () => {
  const sections = [{ id: 'work', name: 'Work', position: [0, 0] as [number, number] },
    { id: 'ideas', name: 'Ideas', position: [3, 0] as [number, number] }]
  assert.equal(sectionAt(sections, [2.9, 0]), 'ideas')
  assert.equal(sectionAt(sections, [2.9, 0], 'work'), 'work')
  assert.equal(sectionAt(sections, [4, 0], 'work'), 'ideas')
  assert.equal(sectionAt(sections, [0, 10]), undefined)
})

test('moving a section changes nearby memberships without shifting notes and can be undone', () => {
  const { createSection, moveSection, undo } = store.getState()
  const [x, y] = sample.position
  const work = createSection('Work', [x, y])!
  const before = note().position
  assert.equal(note().sectionId, work)
  moveSection(work, [sibling.position[0] + 1.5, sibling.position[1] + 1.5])
  assert.equal(note().sectionId, undefined)
  assert.equal(note(sibling.id).sectionId, work)
  assert.equal(note().position, before)
  assert.deepEqual(note().position, sample.position)
  assert.deepEqual(note(sibling.id).position, sibling.position)
  undo()
  assert.equal(note().sectionId, work)
})

test('deleting a section unassigns active and archived notes while leaving their task data intact', () => {
  const { createSection, assignSection, updateTask, editChecklist, archiveNote, deleteSection, undo, redo } = store.getState()
  const research = createSection('Research', [10, -6])!
  assignSection(sample.id, research)
  assignSection(sibling.id, research)
  updateTask(sample.id, { priority: 'high', dueDate: '2026-12-21', completed: true })
  editChecklist(sample.id, { kind: 'add', text: 'Check references' })
  archiveNote(sibling.id)
  const before = store.getState().notes
  deleteSection(research)
  assert.deepEqual(store.getState().sections, [])
  assert.deepEqual(store.getState().notes.map(({ sectionId, ...data }) => data), before.map(({ sectionId, ...data }) => data))
  assert.ok(store.getState().notes.every((entry) => !entry.sectionId))
  undo()
  assert.equal(store.getState().notes, before)
  assert.equal(store.getState().sections[0].id, research)
  redo()
  assert.equal(note().sectionId, undefined)
})

test('search finds titles, descriptions and checklist text with case-insensitive combined terms', () => {
  const notes = [
    { ...sample, title: 'Design review', body: 'Send it to Anya', checklist: [{ id: 'one', text: 'Confirm vendor', done: false }] },
    { ...sibling, title: 'Vendor meeting', body: 'Check in next week' },
  ]
  const find = (query: string) => searchNotes(notes, query, DEFAULT_FILTERS, '2026-11-25').map(({ id }) => id)
  assert.deepEqual(find('  DESIGN  '), [sample.id])
  assert.deepEqual(find('anya'), [sample.id])
  assert.deepEqual(find('confirm vendor'), [sample.id])
  assert.deepEqual(find('Design Anya vendor'), [sample.id])
  assert.deepEqual(find('vendor'), [sample.id, sibling.id])
  assert.deepEqual(find('no match'), [])
})

test('all filter fields can be combined and clearing filters keeps all notes intact', () => {
  const today = '2026-11-25'
  const task = { ...sample, priority: 'high', dueDate: '2026-11-24', sectionId: 'work', completed: true } as const
  const notes: StickyNoteData[] = [
    task,
    { ...task, id: 'archive', archived: true },
    { ...sibling, dueDate: today, sectionId: 'ideas', priority: 'low' },
    { ...sibling, id: 'future', dueDate: '2026-12-02' },
    { ...sibling, id: 'without-date' },
  ]
  const combined = { ...DEFAULT_FILTERS, priority: 'high', completion: 'completed', due: 'overdue', section: 'work' } as const
  assert.deepEqual(searchNotes(notes, '', combined, today).map(({ id }) => id), [sample.id])
  assert.deepEqual(searchNotes(notes, '', { ...combined, archive: 'archived' }, today).map(({ id }) => id), ['archive'])
  assert.deepEqual(searchNotes(notes, '', { ...combined, archive: 'all' }, today).map(({ id }) => id), [sample.id, 'archive'])
  assert.deepEqual(searchNotes(notes, '', { ...DEFAULT_FILTERS, due: 'today', completion: 'open' }, today), [notes[2]])
  assert.deepEqual(searchNotes(notes, '', { ...DEFAULT_FILTERS, due: 'upcoming', section: '' }, today), [notes[3]])
  assert.deepEqual(searchNotes(notes, '', { ...DEFAULT_FILTERS, priority: 'none', due: 'none' }, today), [notes[4]])
  store.setState({ notes })
  store.getState().select(sample.id)
  const before = memory.get(key)
  store.getState().setFilters({ ...DEFAULT_FILTERS, completion: 'open' })
  assert.equal(store.getState().selectedId, null)
  store.getState().setFilters(DEFAULT_FILTERS)
  assert.equal(store.getState().notes, notes)
  assert.equal(memory.get(key), before)
})

test('moving a selected note outside its filtered section clears selection without losing the note', () => {
  const { createSection, updateNote, setFilters, select } = store.getState()
  const id = createSection('Work', sample.position)!
  setFilters({ ...DEFAULT_FILTERS, section: id })
  select(sample.id)
  updateNote(sample.id, { position: [10, 3] })
  assert.equal(note().sectionId, undefined)
  assert.equal(store.getState().selectedId, null)
  assert.deepEqual(note().position, [10, 3])
})

test('focus, reset and opening an archived result do not change wall data or history', () => {
  const { archiveNote, createSection, focusNote, focusSection, openArchivedNote, commandCamera, setPanel } = store.getState()
  const id = createSection('Work', [10, -5])!
  archiveNote(sibling.id)
  const before = store.getState()
  focusSection(id)
  assert.equal(store.getState().cameraCommand?.kind, 'section')
  assert.equal(store.getState().cameraCommand?.targetId, id)
  focusNote(sample.id)
  assert.equal(store.getState().selectedId, sample.id)
  let handled = false
  handleWallShortcut({ key: 'f', target: null, preventDefault: () => { handled = true } } as unknown as KeyboardEvent)
  assert.ok(handled)
  assert.equal(store.getState().cameraCommand?.targetId, sample.id)
  focusNote(sibling.id)
  assert.equal(store.getState().cameraCommand?.targetId, sample.id)
  commandCamera('reset')
  assert.equal(store.getState().cameraCommand?.kind, 'reset')
  setPanel('searchOpen', true)
  openArchivedNote(sibling.id)
  assert.ok(store.getState().tasksOpen)
  assert.equal(store.getState().searchOpen, false)
  assert.equal(store.getState().archiveFocusId, sibling.id)
  assert.equal(store.getState().notes, before.notes)
  assert.equal(store.getState().sections, before.sections)
  assert.equal(store.getState().past, before.past)
})

test('section and resized note focus frame the geometry on desktop and mobile, even on a tilted wall', () => {
  const { createSection, updateNote } = store.getState()
  const id = createSection('Research', [4, -3])!
  updateNote(sample.id, { size: [4, 4.2], rotation: 0.3 })
  const wall = new Group()
  wall.rotation.set(-0.32, 0.44, 0)
  const document = store.getState()
  const section = resolveCameraFocus(document, 'section', id)!
  assert.equal(section.width, SECTION_WIDTH)
  assert.equal(section.height, SECTION_HEIGHT)
  const focusedNote = resolveCameraFocus(document, 'focus', sample.id)!
  assert.ok(focusedNote.width > 4 && focusedNote.height > 4.2)
  for (const aspect of [1440 / 900, 390 / 844]) {
    const camera = new PerspectiveCamera(WALL_CAMERA_FOV, aspect, 0.1, 110)
    for (const { center, width, height } of [section, focusedNote]) {
      const distance = wallFocusDistance(width, height, aspect)
      const target = new Vector3()
      positionWallFocus(wall, center, distance, target, camera.position)
      constrainWallView(wall, target, camera.position, aspect)
      camera.lookAt(target)
      camera.updateMatrixWorld()
      for (const x of [-width / 2, width / 2]) {
        for (const y of [-height / 2, height / 2]) {
          const projected = wall.localToWorld(new Vector3(center[0] + x, center[1] + y, 0)).project(camera)
          assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1)
        }
      }
    }
  }
  assert.equal(store.getState().notes, document.notes)
})

test('version 1 storage preserves section and note data and ignores malformed section records', async () => {
  const { createSection, assignSection, archiveNote, updateNote, editChecklist, updateTask } = store.getState()
  const work = createSection('Work', [10, 0])!
  updateNote(sample.id, { size: [3.5, 4], position: [8.5, -1], rotation: 0.24, color: 'green' })
  assignSection(sample.id, work)
  editChecklist(sample.id, { kind: 'add', text: 'Check progress' })
  updateTask(sample.id, { priority: 'high', dueDate: '2026-12-01', completed: true })
  archiveNote(sample.id)
  const expected = note()
  const saved = JSON.parse(memory.get(key)!)
  assert.equal(saved.version, 1)
  saved.state.sections.push({ id: 'bad', name: 'Bad section', position: [1, null] }, { ...saved.state.sections[0], name: 'Duplicate' })
  saved.state.notes.find((entry: StickyNoteData) => entry.id === sibling.id).sectionId = 'bad'
  store.setState(store.getInitialState())
  memory.set(key, JSON.stringify(saved))
  await store.persist.rehydrate()
  assert.equal(store.getState().sections.length, 1)
  assert.deepEqual(store.getState().sections[0], { id: work, name: 'Work', position: [10, 0] })
  assert.deepEqual(note(), expected)
  assert.deepEqual(note(sibling.id), sibling)
  memory.set(key, JSON.stringify({ version: 1, state: { notes: [sibling] } }))
  await store.persist.rehydrate()
  assert.deepEqual(store.getState().sections, [])
  assert.deepEqual(store.getState().notes, [sibling])
})

test('permanent archive deletion preserves separate section changes in history', () => {
  const { createSection, renameSection, archiveNote, permanentlyDeleteNote, undo } = store.getState()
  const id = createSection('Ideas', [10, 0])!
  archiveNote(sample.id)
  renameSection(id, 'Research')
  permanentlyDeleteNote(sample.id)
  undo()
  assert.equal(store.getState().sections[0].name, 'Ideas')
  undo()
  assert.deepEqual(store.getState().sections, [])
  assert.ok(!note())
})

test('section cap and bounds prevent labels from disappearing over the wall edge', () => {
  for (let index = 0; index < MAX_SECTIONS; index++) assert.ok(store.getState().createSection(`Area ${index + 1}`, [100, -100]))
  assert.equal(store.getState().createSection('Overflow'), undefined)
  const [{ position: [x, y] }] = store.getState().sections
  assert.ok(x + SECTION_WIDTH / 2 < 16)
  assert.ok(y - SECTION_HEIGHT / 2 > -11)
})
