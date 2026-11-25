import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import type { StickyNoteData } from '../src/types/wall.ts'
import { SAMPLE_NOTES } from '../src/utils/constants.ts'
import { dailyProgress, listTodayNotes } from '../src/utils/dailyPlan.ts'
import { deliverReminders, listReminders, parseReminderInput, reminderDelay, reminderInputValue, requestReminderPermission } from '../src/utils/reminders.ts'
import type { ReminderNotifications } from '../src/utils/reminders.ts'

const storeKey = 'wallflow-wall-v1'
const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
} })
const { useWallStore: store } = await import('../src/stores/wallStore.ts')
const [sample, other] = SAMPLE_NOTES
const today = '2026-11-25'
const yesterday = '2026-11-24'
const tomorrow = '2026-11-26'
const future = Date.UTC(2026, 10, 25, 18, 30)
const note = (id = sample.id) => store.getState().notes.find((entry) => entry.id === id)!

beforeEach(() => {
  memory.clear()
  store.setState({ ...store.getInitialState(), notes: structuredClone(SAMPLE_NOTES), today })
})

async function refresh() {
  const saved = memory.get(storeKey)!
  store.setState({ ...store.getInitialState(), today })
  memory.set(storeKey, saved)
  await store.persist.rehydrate()
}

test('Today shows due, overdue and planned work while excluding archived and unrelated work', () => {
  const notes: StickyNoteData[] = [
    { ...sample, id: 'today', dueDate: today },
    { ...sample, id: 'overdue', dueDate: yesterday },
    { ...sample, id: 'planned-note', plannedOn: today, dueDate: tomorrow },
    { ...sample, id: 'planned-item', checklist: [{ id: 'one', text: 'Send it', done: false, plannedOn: today }] },
    { ...sample, id: 'archived', dueDate: today, plannedOn: today, archived: true },
    { ...sample, id: 'due-later', dueDate: tomorrow },
    { ...sample, id: 'done-last-week', dueDate: yesterday, completed: true },
    { ...sample, id: 'old-plan', plannedOn: yesterday },
    { ...sample, id: 'complete-and-due', dueDate: today, completed: true },
    { ...sample, id: 'reminder-today', reminder: { id: 'today-alert', at: new Date(2026, 10, 25, 11).getTime() } },
    { ...sample, id: 'reminder-later', reminder: { id: 'next-alert', at: new Date(2026, 10, 26, 11).getTime() } },
  ]
  assert.deepEqual(listTodayNotes(notes, today).map(({ note, overdue, dueToday, planned, reminderToday }) => [note.id, overdue, dueToday, planned, reminderToday]), [
    ['overdue', true, false, false, false], ['today', false, true, false, false], ['complete-and-due', false, true, false, false],
    ['planned-note', false, false, true, false], ['planned-item', false, false, true, false], ['reminder-today', false, false, false, true],
  ])
})

test('planning and unplanning whole notes and checklist items leaves the original due date alone', () => {
  const { updateTask, editChecklist, setPlanned, undo, redo } = store.getState()
  updateTask(sample.id, { dueDate: tomorrow })
  editChecklist(sample.id, { kind: 'add', text: 'Send specifications' })
  const itemId = note().checklist![0].id
  setPlanned(sample.id, true)
  setPlanned(sample.id, true, itemId)
  const checkpointCount = store.getState().past.length
  setPlanned(sample.id, true, itemId)
  setPlanned(sample.id, true, 'unknown item')
  assert.equal(store.getState().past.length, checkpointCount)
  assert.equal(note().plannedOn, today)
  assert.equal(note().checklist![0].plannedOn, today)
  assert.equal(note().dueDate, tomorrow)
  setPlanned(sample.id, false, itemId)
  setPlanned(sample.id, false)
  assert.equal(note().plannedOn, undefined)
  assert.equal(note().checklist![0].plannedOn, undefined)
  undo()
  undo()
  assert.equal(note().plannedOn, today)
  assert.equal(note().checklist![0].plannedOn, today)
  redo()
  assert.equal(note().checklist![0].plannedOn, undefined)
  assert.equal(note().dueDate, tomorrow)
})

test('daily progress counts only today’s planned notes and items, using current completion', () => {
  const { updateTask, editChecklist, setPlanned, setToday, archiveNote, restoreNote } = store.getState()
  editChecklist(sample.id, { kind: 'add', text: 'Due later' })
  editChecklist(sample.id, { kind: 'add', text: 'Another one' })
  const [planned, unplanned] = note().checklist!
  setPlanned(sample.id, true)
  setPlanned(sample.id, true, planned.id)
  editChecklist(sample.id, { kind: 'toggle', id: unplanned.id })
  updateTask(other.id, { completed: true, dueDate: today })
  const progress = () => dailyProgress(store.getState().notes, store.getState().today)
  assert.deepEqual(progress(), { completed: 0, total: 2 })
  editChecklist(sample.id, { kind: 'toggle', id: planned.id })
  assert.deepEqual(progress(), { completed: 1, total: 2 })
  updateTask(sample.id, { completed: true })
  assert.deepEqual(progress(), { completed: 2, total: 2 })
  archiveNote(sample.id)
  assert.deepEqual(progress(), { completed: 0, total: 0 })
  restoreNote(sample.id)
  assert.deepEqual(progress(), { completed: 2, total: 2 })
  setToday(tomorrow)
  assert.deepEqual(progress(), { completed: 0, total: 0 })
  assert.equal(note().plannedOn, today)
})

test('editing or deleting a planned checklist entry preserves undo and the plan follows the item ID', () => {
  const { editChecklist, setPlanned, undo } = store.getState()
  editChecklist(sample.id, { kind: 'add', text: 'First' })
  editChecklist(sample.id, { kind: 'add', text: 'Second' })
  const item = note().checklist![0]
  setPlanned(sample.id, true, item.id)
  editChecklist(sample.id, { kind: 'move', id: item.id, direction: 1 })
  editChecklist(sample.id, { kind: 'edit', id: item.id, text: 'First revised' })
  assert.deepEqual(note().checklist![1], { ...item, text: 'First revised', plannedOn: today })
  editChecklist(sample.id, { kind: 'delete', id: item.id })
  assert.equal(dailyProgress(store.getState().notes, today).total, 0)
  undo()
  assert.equal(dailyProgress(store.getState().notes, today).total, 1)
})

test('a note reminder can be created, rescheduled, removed and undone independently of its due date', () => {
  const { setReminder, updateTask, undo, redo } = store.getState()
  updateTask(sample.id, { dueDate: tomorrow })
  setReminder(sample.id, future)
  const original = note().reminder!
  setReminder(sample.id, future)
  assert.equal(note().reminder, original)
  setReminder(sample.id, Number.NaN)
  setReminder(sample.id, 1e18)
  assert.equal(note().reminder, original)
  setReminder(sample.id, future + 3600000)
  const revised = note().reminder!
  assert.equal(revised.at, future + 3600000)
  assert.notEqual(revised.id, original.id)
  setReminder(sample.id)
  assert.equal(note().reminder, undefined)
  undo()
  assert.equal(note().reminder, revised)
  undo()
  assert.equal(note().reminder, original)
  redo()
  assert.equal(note().reminder, revised)
  assert.equal(note().dueDate, tomorrow)
})

test('duplicate notes retain content but get independent plans and reminders', () => {
  const { editChecklist, setPlanned, setReminder, duplicateNote } = store.getState()
  editChecklist(sample.id, { kind: 'add', text: 'Review the checklist' })
  const itemId = note().checklist![0].id
  setPlanned(sample.id, true)
  setPlanned(sample.id, true, itemId)
  setReminder(sample.id, future)
  duplicateNote(sample.id)
  const copy = note(store.getState().selectedId!)
  assert.equal(copy.reminder, undefined)
  assert.equal(copy.plannedOn, undefined)
  assert.equal(copy.checklist![0].plannedOn, undefined)
  assert.equal(copy.checklist![0].text, note().checklist![0].text)
  assert.notEqual(copy.checklist![0].id, itemId)
  assert.ok(note().reminder)
})

function notificationClient(start: NotificationPermission, request: () => Promise<NotificationPermission> = async () => 'granted') {
  let permission = start
  let requests = 0
  const messages: Array<{ title: string; tag?: string }> = []
  const notifications: ReminderNotifications = {
    get permission() { return permission },
    async requestPermission() { requests++; permission = await request(); return permission },
    show: (title, options) => { messages.push({ title, tag: options.tag }) },
  }
  return { messages, notifications, get requests() { return requests } }
}

test('permission requests happen only through the explicit request path and denied scheduling stays silent', async () => {
  store.getState().setReminder(sample.id, future)
  const notes = store.getState().notes
  const granted = notificationClient('default')
  assert.deepEqual(deliverReminders(notes, [], future, granted.notifications).delivered, [])
  assert.equal(granted.requests, 0)
  assert.equal(await requestReminderPermission(granted.notifications), 'granted')
  assert.equal(granted.requests, 1)
  assert.deepEqual(deliverReminders(notes, [], future, granted.notifications).delivered, [note().reminder!.id])
  assert.deepEqual(granted.messages, [{ title: sample.title, tag: `wallflow-${note().reminder!.id}` }])
  const denied = notificationClient('default', async () => 'denied')
  assert.equal(await requestReminderPermission(denied.notifications), 'denied')
  assert.equal(await requestReminderPermission(denied.notifications), 'denied')
  assert.equal(denied.requests, 1)
  assert.deepEqual(deliverReminders(notes, [], future, denied.notifications).delivered, [])
  assert.deepEqual(denied.messages, [])
})

test('missing or failing notification APIs keep reminders available in the app without recording delivery', async () => {
  assert.equal(await requestReminderPermission(), 'unavailable')
  const unsupported = notificationClient('default', async () => { throw new Error('Unavailable') })
  assert.equal(await requestReminderPermission(unsupported.notifications), 'unavailable')
  store.getState().setReminder(sample.id, future)
  const notes = store.getState().notes
  const failing = { ...notificationClient('granted').notifications, show() { throw new Error('Cannot display') } }
  assert.deepEqual(deliverReminders(notes, [], future, failing), { delivered: [], nextAt: undefined, failed: true })
  assert.equal(listReminders(notes)[0].reminder.at, future)
})

test('reminders recover missed times, skip completed and archived notes and schedule the next alert', () => {
  const notes: StickyNoteData[] = [
    { ...sample, id: 'future', reminder: { id: 'later', at: future + 1000 } },
    { ...sample, id: 'missed', reminder: { id: 'earlier', at: future - 60000 } },
    { ...sample, id: 'archived', reminder: { id: 'archived', at: future - 2000 }, archived: true },
    { ...sample, id: 'finished', reminder: { id: 'finished', at: future - 1000 }, completed: true },
  ]
  const browser = notificationClient('granted')
  assert.deepEqual(listReminders(notes).map(({ note }) => note.id), ['missed', 'future'])
  assert.deepEqual(deliverReminders(notes, [], future, browser.notifications), { delivered: ['earlier'], nextAt: future + 1000, failed: false })
  assert.equal(reminderDelay(future + 1000, future), 1000)
  assert.equal(reminderDelay(3e9, 0), 2147483647)
  assert.deepEqual(deliverReminders(notes, ['earlier'], future + 1000, browser.notifications).delivered, ['later'])
})

test('local reminder inputs round-trip and timezone changes preserve the saved instant', () => {
  const remindersModule = new URL('../src/utils/reminders.ts', import.meta.url).href
  const printValues = (zone: string) => JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `
    import { parseReminderInput, reminderInputValue } from ${JSON.stringify(remindersModule)};
    const at = ${future};
    const local = reminderInputValue(at);
    console.log(JSON.stringify([local, parseReminderInput(local), parseReminderInput('2026-03-08T02:30') ?? null]));
  `], { env: { ...process.env, TZ: zone }, encoding: 'utf8' }))
  assert.deepEqual(printValues('America/New_York'), ['2026-11-25T13:30', future, null])
  assert.deepEqual(printValues('Asia/Kolkata').slice(0, 2), ['2026-11-26T00:00', future])
  assert.equal(parseReminderInput(reminderInputValue(future)), future)
  assert.equal(parseReminderInput('2026-02-30T10:00'), undefined)
  assert.equal(parseReminderInput('2026-11-25T24:00'), undefined)
})

test('refresh preserves plans, reminders, notification receipts and existing wall fields', async () => {
  const { createSection, assignSection, updateNote, updateTask, editChecklist, setPlanned, setReminder,
    markRemindersNotified, setReminderPermission, setWallName, setLighting } = store.getState()
  const section = createSection('Studio', [8, -6])!
  updateNote(sample.id, { position: [8, -6], size: [3, 3.2], rotation: 0.3, color: 'green' })
  assignSection(sample.id, section)
  updateTask(sample.id, { priority: 'high', dueDate: tomorrow })
  editChecklist(sample.id, { kind: 'add', text: 'Update the draft' })
  setPlanned(sample.id, true)
  setPlanned(sample.id, true, note().checklist![0].id)
  setReminder(sample.id, future)
  const expected = note()
  markRemindersNotified([expected.reminder!.id, 'invalid', expected.reminder!.id])
  setReminderPermission('granted')
  setWallName('My plans')
  setLighting('warm')
  await refresh()
  const state = store.getState()
  assert.deepEqual(note(), expected)
  assert.deepEqual(state.sections, [{ id: section, name: 'Studio', position: [8, -6] }])
  assert.equal(state.wallName, 'My plans')
  assert.equal(state.lighting, 'warm')
  assert.deepEqual(state.notifiedReminders, [expected.reminder!.id])
  assert.equal(state.reminderPermission, 'unavailable')
  assert.deepEqual(deliverReminders(state.notes, state.notifiedReminders, future + 1, notificationClient('granted').notifications).delivered, [])
})

test('older saved walls and malformed planner or reminder fields retain valid note and section data', async () => {
  const section = { id: 'research', name: 'Research', position: [7, 1] }
  const original = { ...sample, sectionId: section.id, checklist: [{ id: 'first', text: 'Keep this', done: true }] }
  memory.set(storeKey, JSON.stringify({ version: 1, state: { notes: [original, other], sections: [section] } }))
  await store.persist.rehydrate()
  assert.deepEqual(note(), original)
  assert.deepEqual(store.getState().sections, [section])

  const malformed = { ...original, plannedOn: '2026-02-30', reminder: { id: 'invalid', at: '2026-11-25T13:00' },
    checklist: [{ ...original.checklist[0], plannedOn: true }] }
  memory.set(storeKey, JSON.stringify({ version: 1, state: { notes: [malformed, other], sections: [section], notifiedReminders: ['invalid'] } }))
  await store.persist.rehydrate()
  assert.deepEqual(note(), original)
  assert.deepEqual(store.getState().notifiedReminders, [])
})

test('notification receipts survive undo without redelivery and permanent deletion removes them', () => {
  const { setReminder, markRemindersNotified, undo, redo, archiveNote, permanentlyDeleteNote } = store.getState()
  setReminder(sample.id, future)
  const id = note().reminder!.id
  markRemindersNotified([id])
  undo()
  assert.equal(note().reminder, undefined)
  redo()
  const state = store.getState()
  assert.deepEqual(deliverReminders(state.notes, state.notifiedReminders, future, notificationClient('granted').notifications).delivered, [])
  archiveNote(sample.id)
  permanentlyDeleteNote(sample.id)
  assert.deepEqual(store.getState().notifiedReminders, [])
})
