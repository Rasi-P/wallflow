import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { StickyNoteData } from '../src/types/wall.ts'
import { MAX_NOTES, SAMPLE_NOTES } from '../src/utils/constants.ts'
import { countActiveNotes, getChecklistProgress, getTaskInk, listDueNotes, MAX_CHECKLIST_ITEMS } from '../src/utils/noteTasks.ts'
import { dueStatus, formatDueDate, isDueDate, localDay } from '../src/utils/taskDates.ts'
import { paintNoteInk } from '../src/three/textures.ts'

const storeKey = 'wallflow-wall-v1'
const data = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value) },
} })
const { useWallStore: store } = await import('../src/stores/wallStore.ts')
const [sample, other] = SAMPLE_NOTES
const note = (id = sample.id) => store.getState().notes.find((entry) => entry.id === id)!

beforeEach(() => {
  data.clear()
  store.setState({ ...store.getInitialState(), notes: structuredClone(SAMPLE_NOTES) })
})

async function refresh() {
  const saved = data.get(storeKey)!
  store.setState(store.getInitialState())
  data.set(storeKey, saved)
  await store.persist.rehydrate()
}

test('checklist items can be added, edited, checked, reordered and removed', () => {
  const { editChecklist } = store.getState()
  editChecklist(sample.id, { kind: 'add', text: '   ' })
  assert.equal(note().checklist, undefined)
  editChecklist(sample.id, { kind: 'add', text: '  Get quotes  ' })
  editChecklist(sample.id, { kind: 'add', text: 'Choose a vendor' })
  const [first, second] = note().checklist!
  assert.equal(first.text, 'Get quotes')
  editChecklist(sample.id, { kind: 'edit', id: first.id, text: 'Get two quotes' })
  editChecklist(sample.id, { kind: 'toggle', id: first.id })
  assert.equal(getChecklistProgress(note().checklist), '1/2')
  assert.equal(note().completed, undefined)
  editChecklist(sample.id, { kind: 'move', id: second.id, direction: -1 })
  assert.deepEqual(note().checklist!.map((item) => item.id), [second.id, first.id])
  editChecklist(sample.id, { kind: 'delete', id: second.id })
  assert.deepEqual(note().checklist, [{ id: first.id, text: 'Get two quotes', done: true }])
})

test('task details edited inline form one undo entry and undo and redo preserve item identities', () => {
  const { editNote, editChecklist, writeNoteText, updateTask, finishEditing, undo, redo } = store.getState()
  editNote(sample.id, true)
  writeNoteText(sample.id, { title: 'Plan the launch' })
  editChecklist(sample.id, { kind: 'add', text: 'Confirm dates' })
  const itemId = note().checklist![0].id
  editChecklist(sample.id, { kind: 'toggle', id: itemId })
  updateTask(sample.id, { priority: 'medium', dueDate: '2026-12-04' })
  assert.equal(store.getState().past.length, 0)
  finishEditing()
  const edited = note()
  assert.equal(store.getState().past.length, 1)
  undo()
  assert.deepEqual(note(), sample)
  redo()
  assert.deepEqual(note(), edited)
  assert.equal(note().checklist![0].id, itemId)
})

test('a new checklist-only note survives Escape and a duplicate edits independently', () => {
  const { addNote, editChecklist, finishEditing, duplicateNote } = store.getState()
  addNote()
  const original = store.getState().editingId!
  editChecklist(original, { kind: 'add', text: 'Call the team' })
  finishEditing(true)
  duplicateNote(original)
  const copy = store.getState().selectedId!
  const copyItem = note(copy).checklist![0]
  assert.notEqual(copyItem.id, note(original).checklist![0].id)
  editChecklist(copy, { kind: 'edit', id: copyItem.id, text: 'Send an update' })
  assert.equal(note(original).checklist![0].text, 'Call the team')
  assert.equal(note(copy).checklist![0].text, 'Send an update')
})

test('priority can switch between all three levels, clear, and undo changes', () => {
  const { updateTask, undo, redo } = store.getState()
  for (const priority of ['low', 'medium', 'high'] as const) {
    updateTask(sample.id, { priority })
    assert.equal(note().priority, priority)
  }
  updateTask(sample.id, { priority: undefined })
  assert.equal(note().priority, undefined)
  undo()
  assert.equal(note().priority, 'high')
  redo()
  assert.equal(note().priority, undefined)
})

test('due dates are valid calendar days and survive changes and removal across refresh', async () => {
  const { updateTask } = store.getState()
  assert.ok(isDueDate('2028-02-29'))
  for (const value of ['2026-02-29', '1900-02-29', '2026-04-31', '2026-1-01', '2026-01-01T00:00:00Z']) {
    assert.equal(isDueDate(value), false)
  }
  const today = localDay(new Date(2026, 10, 25, 23, 59))
  assert.equal(today, '2026-11-25')
  assert.equal(dueStatus('2026-11-24', today), 'overdue')
  assert.equal(dueStatus('2026-11-25', today), 'today')
  assert.equal(dueStatus('2026-11-26', today), 'upcoming')
  assert.equal(formatDueDate(today, today), new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(2026, 10, 25)))
  updateTask(sample.id, { dueDate: '2028-02-29' })
  await refresh()
  assert.equal(note().dueDate, '2028-02-29')
  updateTask(sample.id, { dueDate: '2026-11-26' })
  updateTask(sample.id, { dueDate: '2026-11-31' })
  await refresh()
  assert.equal(note().dueDate, '2026-11-26')
  updateTask(sample.id, { dueDate: undefined })
  await refresh()
  assert.equal(note().dueDate, undefined)
})

test('the deadlines list includes only dated open wall notes and sorts by calendar day', () => {
  const entries = [
    { ...sample, id: 'later', dueDate: '2026-12-10' },
    { ...sample, id: 'completed', dueDate: '2026-11-23', completed: true },
    { ...sample, id: 'today', dueDate: '2026-11-25' },
    { ...sample, id: 'archived', dueDate: '2026-11-22', archived: true },
    sample,
    { ...sample, id: 'overdue', dueDate: '2026-11-24' },
  ]
  assert.deepEqual(listDueNotes(entries).map(({ id }) => id), ['overdue', 'today', 'later'])
})

test('completing and reopening a task keeps its writing, geometry and checklist', async () => {
  const { updateNote, updateTask, editChecklist, undo } = store.getState()
  updateNote(sample.id, { size: [3.2, 3.2], position: [6, -2], rotation: 0.18, color: 'violet' })
  editChecklist(sample.id, { kind: 'add', text: 'Draft the outline' })
  updateTask(sample.id, { priority: 'high', dueDate: '2028-01-03' })
  const original = note()
  updateTask(sample.id, { completed: true })
  await refresh()
  assert.deepEqual(note(), { ...original, completed: true })
  assert.equal(getTaskInk(note(), '2028-02-01')!.overdue, false)
  updateTask(sample.id, { completed: false })
  assert.equal(note().completed, undefined)
  assert.equal(getTaskInk(note(), '2028-02-01')!.overdue, true)
  undo()
  assert.equal(note().completed, true)
})

test('archive and restore round-trip the note and each is undoable', async () => {
  const { select, archiveNote, restoreNote, undo, redo, editChecklist, updateTask, updateNote } = store.getState()
  updateNote(sample.id, { size: [3.1, 3.1], position: [5, 1], rotation: -0.3 })
  editChecklist(sample.id, { kind: 'add', text: 'Check references' })
  updateTask(sample.id, { dueDate: '2026-12-02', priority: 'low', completed: true })
  const original = note()
  select(sample.id)
  archiveNote(sample.id)
  assert.equal(store.getState().selectedId, null)
  assert.equal(countActiveNotes(store.getState().notes), SAMPLE_NOTES.length - 1)
  undo()
  assert.deepEqual(note(), original)
  redo()
  await refresh()
  assert.deepEqual(note(), { ...original, archived: true })
  select(sample.id)
  assert.equal(store.getState().selectedId, null)
  restoreNote(sample.id)
  assert.deepEqual(note(), original)
  undo()
  assert.equal(note().archived, true)
  redo()
  assert.deepEqual(note(), original)
})

test('archive records survive a full wall reload and restore when a slot opens', async () => {
  const visible = Array.from({ length: MAX_NOTES }, (_, index) => ({ ...sample, id: `active-${index}` }))
  store.setState({ notes: [...visible, { ...sample, archived: true }] })
  await refresh()
  assert.equal(store.getState().notes.length, MAX_NOTES + 1)
  assert.equal(countActiveNotes(store.getState().notes), MAX_NOTES)
  const { restoreNote, archiveNote } = store.getState()
  restoreNote(sample.id)
  assert.equal(note().archived, true)
  archiveNote(visible[0].id)
  restoreNote(sample.id)
  assert.equal(note().archived, undefined)
  assert.equal(countActiveNotes(store.getState().notes), MAX_NOTES)
})

test('permanent deletion purges both history branches and leaves other changes undoable', async () => {
  const { archiveNote, permanentlyDeleteNote, updateNote, undo, redo } = store.getState()
  permanentlyDeleteNote(sample.id)
  assert.equal(note().id, sample.id)
  archiveNote(sample.id)
  updateNote(other.id, { title: 'Keep this edit' })
  undo()
  permanentlyDeleteNote(sample.id)
  assert.equal(note(), undefined)
  assert.ok([...store.getState().past, ...store.getState().future].every(({ notes }) => notes.every(({ id }) => id !== sample.id)))
  redo()
  assert.equal(note(other.id).title, 'Keep this edit')
  undo()
  assert.equal(note(other.id).title, other.title)
  await refresh()
  assert.equal(note(), undefined)
})

test('legacy notes keep optional dimensions and invalid task data never discards usable paper', async () => {
  const sized: StickyNoteData = { ...sample, size: [3, 3], position: [2, 3], rotation: 0.2 }
  data.set(storeKey, JSON.stringify({ version: 1, state: { notes: [
    sized, other, {
      ...sample, id: 'bad-metadata', dueDate: '2026-04-31', priority: 'urgent', completed: 'true', archived: 'true',
      checklist: [null, { id: 'a', text: 'x'.repeat(200), done: true }, { id: 'a', text: 'duplicate' },
        ...Array.from({ length: MAX_CHECKLIST_ITEMS }, (_, index) => ({ id: `item-${index}`, text: 'Saved item', done: false }))],
    },
  ] } }))
  await store.persist.rehydrate()
  assert.deepEqual(note(), sized)
  assert.deepEqual(note(other.id), other)
  const { checklist, ...recovered } = note('bad-metadata')
  assert.deepEqual(recovered, { ...sample, id: 'bad-metadata' })
  assert.equal(checklist!.length, MAX_CHECKLIST_ITEMS)
  assert.deepEqual(checklist![0], { id: 'a', text: 'x'.repeat(120), done: true })
  assert.equal(checklist!.filter((item) => item.id === 'a').length, 1)
})

test('the shared paper layout keeps checklist previews, progress and due status within the note', () => {
  const task = getTaskInk({
    checklist: Array.from({ length: 5 }, (_, index) => ({ id: String(index), text: 'Research '.repeat(12), done: index < 2 })),
    priority: 'high', dueDate: '2026-11-22',
  }, '2026-11-25')!
  const lines: Array<{ text: string; x: number; y: number; width: number }> = []
  let boxes = 0, checks = 0
  const context = {
    measureText: (text: string) => ({ width: Array.from(text).length * 20 }),
    fillText: (text: string, x: number, y: number, width: number) => { lines.push({ text, x, y, width }) },
    strokeRect: () => { boxes++ }, stroke: () => { checks++ }, beginPath() {}, moveTo() {}, lineTo() {},
  } as unknown as CanvasRenderingContext2D
  paintNoteInk(context, { title: 'Prepare for an important meeting', body: 'Research '.repeat(24), task }, '#fff')
  assert.equal(boxes, 3)
  assert.equal(checks, 2)
  assert.ok(lines.some(({ text }) => text.includes('2/5 checked') && text.includes('High priority')))
  assert.ok(lines.some(({ text }) => text.startsWith('OVERDUE')))
  assert.ok(lines.every(({ x, y, width }) => x >= 100 && x + width <= 924 && y <= 944))
})
