import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createWorkspaceStore } from '../src/stores/workspaceStore.ts'
import { FIRST_BOARD_ID, LEGACY_WALL_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from '../src/stores/workspaceStorage.ts'
import type { Board, SavedWorkspace } from '../src/types/workspace.ts'
import type { StickyNoteData, WallDocument } from '../src/types/wall.ts'
import { SAMPLE_NOTES } from '../src/utils/constants.ts'
import { deliverWorkspaceReminders } from '../src/utils/reminders.ts'
import type { ReminderNotifications } from '../src/utils/reminders.ts'

const day = '2026-11-26'
const due = Date.UTC(2026, 10, 26, 9)
const note: StickyNoteData = {
  ...SAMPLE_NOTES[0], id: 'original', position: [4, -2], rotation: 0.122, size: [3, 3.2],
  title: 'Draft the outline', body: 'First line\nSecond line', color: 'blue', typography: 'sans', doodle: 'leaf',
  sectionId: 'ideas', priority: 'high', dueDate: day, plannedOn: day, reminder: { id: 'same-reminder', at: due },
  checklist: [{ id: 'draft', text: 'Send the outline', done: true, plannedOn: day }],
}
const archived: StickyNoteData = { ...SAMPLE_NOTES[1], id: 'archived', archived: true, completed: true }
const document: WallDocument = {
  notes: [archived, note], sections: [{ id: 'ideas', name: 'Ideas', position: [4, -2] }], wallRotation: [3, -7],
}
const preferences: Board['preferences'] = {
  showHints: false, onboardingComplete: true,
  noteDefaults: { color: 'violet', typography: 'sans', size: 'large', rotation: 'straight' },
}
const presentation: Board['presentation'] = {
  lighting: 'warm', appearance: { theme: 'study', shade: 'mist', intensity: 110, ambience: 'airy' },
}
const legacy = JSON.stringify({
  version: 1,
  state: { ...document, ...preferences, ...presentation, wallName: 'Original wall', notifiedReminders: [note.reminder!.id] },
}, null, 2)

function device(legacyValue?: string) {
  const data = new Map<string, string>()
  if (legacyValue !== undefined) data.set(LEGACY_WALL_STORAGE_KEY, legacyValue)
  const health = { available: true, readsBlocked: false, writesBlocked: false }
  const writes: string[] = []
  const storage = {
    getItem(key: string) {
      if (health.readsBlocked) throw new Error('Storage blocked')
      return data.get(key) ?? null
    },
    setItem(key: string, value: string) {
      if (health.writesBlocked) throw new Error('Quota exceeded')
      writes.push(key)
      data.set(key, value)
    },
  }
  const open = () => createWorkspaceStore(storage, (available) => { health.available = available })
  const read = (): SavedWorkspace => JSON.parse(data.get(WORKSPACE_STORAGE_KEY)!)
  return { data, health, writes, open, read }
}

test('legacy migration preserves the full document, ordering, and preferences and keeps the exact legacy bytes', () => {
  const { data, writes, open, read } = device(legacy)
  const workspace = open()
  const saved = read()
  assert.equal(saved.version, 2)
  assert.deepEqual(saved.boardOrder, [FIRST_BOARD_ID])
  assert.equal(saved.activeBoardId, FIRST_BOARD_ID)
  assert.deepEqual(saved.boards[FIRST_BOARD_ID], {
    id: FIRST_BOARD_ID, name: 'Original wall', document, preferences, presentation,
    notifiedReminders: [note.reminder!.id],
  })
  assert.deepEqual(workspace.wall.getState().notes, document.notes)
  assert.deepEqual(open().getState(), saved)
  assert.deepEqual(writes, [WORKSPACE_STORAGE_KEY])
  assert.equal(data.get(LEGACY_WALL_STORAGE_KEY), legacy)
})

test('an empty legacy wall stays empty and a new browser still starts with the current samples', () => {
  const existing = device(JSON.stringify({ version: 1, state: { notes: [] } }))
  assert.deepEqual(existing.open().wall.getState().notes, [])
  assert.equal(existing.open().wall.getState().onboardingComplete, true)
  const fresh = device()
  assert.deepEqual(fresh.open().wall.getState().notes, SAMPLE_NOTES)
  assert.equal(fresh.open().wall.getState().onboardingComplete, false)
  assert.deepEqual(fresh.writes, [])
})

test('new boards get independent blank documents, stable names, and display order across refresh', () => {
  const { data, open } = device(legacy)
  const workspace = open()
  assert.equal(workspace.createBoard('   '), undefined)
  const second = workspace.createBoard('  Projects  ')!
  const third = workspace.createBoard('Someday')!
  assert.notEqual(second, third)
  assert.equal(workspace.getState().activeBoardId, FIRST_BOARD_ID)
  assert.deepEqual(workspace.getState().boardOrder, [FIRST_BOARD_ID, second, third])
  assert.equal(workspace.getState().boards[second].name, 'Projects')
  assert.equal(workspace.renameBoard(third, '  Long-term plans  '), true)
  assert.equal(workspace.renameBoard(third, '   '), false)
  assert.equal(workspace.renameBoard('missing', 'Work'), false)
  assert.equal(workspace.switchBoard(second), true)
  const state = workspace.wall.getState()
  assert.deepEqual(state.notes, [])
  assert.deepEqual(state.sections, [])
  assert.deepEqual(state.notifiedReminders, [])
  assert.equal(state.onboardingComplete, true)
  assert.equal(state.noteDefaults.color, 'yellow')
  state.setWallName('Project notes')

  const restored = open()
  assert.equal(restored.wall.getState().wallName, 'Project notes')
  assert.deepEqual(restored.getState(), workspace.getState())
  assert.equal(data.get(LEGACY_WALL_STORAGE_KEY), legacy)
})

test('board stepping follows display order without wrapping or changing the document', () => {
  const { open, writes } = device(legacy)
  const workspace = open()
  const second = workspace.createBoard('Research')!
  const third = workspace.createBoard('Later')!
  const initial = structuredClone(workspace.getState().boards)
  const writeCount = writes.length
  assert.equal(workspace.stepBoard(-1), false)
  assert.equal(writes.length, writeCount)
  assert.equal(workspace.stepBoard(1), true)
  assert.equal(workspace.getState().activeBoardId, second)
  assert.equal(workspace.stepBoard(1), true)
  assert.equal(workspace.getState().activeBoardId, third)
  assert.equal(workspace.stepBoard(1), false)
  assert.equal(workspace.stepBoard(-1), true)
  assert.equal(open().getState().activeBoardId, second)
  assert.deepEqual(workspace.getState().boards, initial)
})

test('all durable edits stay on their board, including when note and section IDs match', () => {
  const { open, read } = device(legacy)
  const workspace = open()
  const second = workspace.createBoard('Work')!
  const firstBefore = structuredClone(workspace.getState().boards[FIRST_BOARD_ID])
  workspace.switchBoard(second)
  workspace.wall.setState({ notes: [structuredClone(note)], sections: structuredClone(document.sections) })
  const state = workspace.wall.getState()
  state.setToday(day)
  state.renameSection('ideas', 'Work ideas')
  state.updateNote(note.id, { title: 'Work title', position: [8, 2], size: [2.8, 3.4], rotation: -0.24 })
  state.setPlanned(note.id, false)
  state.setPlanned(note.id, false, 'draft')
  state.editChecklist(note.id, { kind: 'add', text: 'Check the source' })
  state.setNoteDefaults({ color: 'pink', size: 'compact' })
  state.setAppearance({ theme: 'lab' })
  state.setShowHints(false)
  state.rotateWall([1, 2])
  state.archiveNote(note.id)
  assert.deepEqual(workspace.getState().boards[FIRST_BOARD_ID], firstBefore)

  const restored = open()
  const savedNote = restored.wall.getState().notes[0]
  assert.equal(savedNote.archived, true)
  assert.equal(savedNote.plannedOn, undefined)
  assert.equal(savedNote.checklist?.[0].plannedOn, undefined)
  assert.equal(savedNote.checklist?.[1].text, 'Check the source')
  assert.deepEqual(restored.getState().boards[second], read().boards[second])
  restored.switchBoard(FIRST_BOARD_ID)
  assert.deepEqual(restored.wall.getState().notes, document.notes)
})

test('switching finishes editing on the source and cached actions remain scoped to that board', () => {
  const workspace = device(legacy).open()
  const second = workspace.createBoard('Work')!
  workspace.switchBoard(second)
  workspace.wall.setState({ notes: [{ ...note, title: 'Second board title' }] })
  workspace.switchBoard(FIRST_BOARD_ID)
  const source = workspace.wall.getState()
  source.editNote(note.id)
  source.writeNoteText(note.id, { title: 'Edited on the first board' })
  source.setDragging(note.id)
  assert.equal(workspace.stepBoard(1), false)
  assert.equal(workspace.deleteBoard(FIRST_BOARD_ID), false)
  source.setDragging(null)

  assert.equal(workspace.stepBoard(1), true)
  assert.equal(workspace.wall.getState().editingId, null)
  source.updateNote(note.id, { body: 'A late action on the first board' })
  assert.equal(workspace.wall.getState().notes[0].title, 'Second board title')
  assert.equal(workspace.wall.getState().notes[0].body, note.body)
  workspace.switchBoard(FIRST_BOARD_ID)
  assert.equal(workspace.wall.getState().notes[1].title, 'Edited on the first board')
  assert.equal(workspace.wall.getState().notes[1].body, 'A late action on the first board')
  assert.equal(workspace.wall.getState().selectedId, null)
  assert.equal(workspace.wall.getState().editingId, null)
})

test('registry observers see the incoming wall and inactive edits do not publish to the active wall', () => {
  const workspace = device(legacy).open()
  const first = workspace.wall.getState()
  const second = workspace.createBoard('Projects')!
  const observed: string[] = []
  workspace.subscribe((next, previous) => {
    if (next.activeBoardId !== previous.activeBoardId) observed.push(workspace.wall.getState().wallName)
  })
  workspace.switchBoard(second)
  const changes: string[] = []
  workspace.wall.subscribe((state) => changes.push(state.wallName))
  first.setWallName('Updated in the background')
  assert.deepEqual(observed, ['Projects'])
  assert.deepEqual(changes, [])
  assert.equal(workspace.getState().boards[FIRST_BOARD_ID].name, 'Updated in the background')
})

test('undo and redo histories remain independent across switches and reset on refresh', () => {
  const { open } = device(legacy)
  const workspace = open()
  const first = workspace.wall.getState()
  first.updateNote(note.id, { title: 'First board edit' })
  first.undo()
  const second = workspace.createBoard('Project')!
  workspace.switchBoard(second)
  const target = workspace.wall.getState()
  target.addNote()
  target.writeNoteText(workspace.wall.getState().selectedId!, { title: 'Second board note' })
  target.finishEditing()
  target.undo()
  assert.deepEqual(workspace.wall.getState().notes, [])
  workspace.switchBoard(FIRST_BOARD_ID)
  assert.equal(workspace.wall.getState().notes[1].title, note.title)
  first.redo()
  assert.equal(workspace.wall.getState().notes[1].title, 'First board edit')
  workspace.switchBoard(second)
  target.redo()
  assert.equal(workspace.wall.getState().notes[0].title, 'Second board note')
  const reloaded = open()
  assert.deepEqual(reloaded.wall.getState().past, [])
  assert.deepEqual(reloaded.wall.getState().future, [])
  reloaded.switchBoard(FIRST_BOARD_ID)
  assert.deepEqual(reloaded.wall.getState().past, [])
  assert.equal(reloaded.wall.getState().notes[1].title, 'First board edit')
})

test('deleting boards keeps their neighbors and never deletes the final board', () => {
  const { open, read } = device(legacy)
  const workspace = open()
  const second = workspace.createBoard('Work')!
  const third = workspace.createBoard('Research')!
  const last = workspace.createBoard('Personal')!
  workspace.switchBoard(second)
  const obsolete = workspace.wall.getState()
  assert.equal(workspace.deleteBoard(second), true)
  assert.equal(workspace.getState().activeBoardId, third)
  obsolete.setWallName('Do not recreate deleted board')
  assert.equal(workspace.deleteBoard(last), true)
  assert.equal(workspace.getState().activeBoardId, third)
  assert.equal(workspace.deleteBoard(third), true)
  assert.deepEqual(read().boardOrder, [FIRST_BOARD_ID])
  assert.equal(workspace.deleteBoard(FIRST_BOARD_ID), false)
  assert.equal(workspace.deleteBoard('missing'), false)
  assert.equal(workspace.switchBoard('missing'), false)
  assert.deepEqual(open().wall.getState().notes, document.notes)
})

test('the reminder scheduler respects each board’s receipts and schedules inactive boards', () => {
  const { open } = device(legacy)
  const workspace = open()
  const second = workspace.createBoard('Work')!
  const nextAt = due + 5000
  const future: StickyNoteData = { ...note, id: 'future', reminder: { id: 'upcoming', at: nextAt } }
  workspace.switchBoard(second)
  workspace.wall.setState({ notes: [structuredClone(note), future] })
  workspace.switchBoard(FIRST_BOARD_ID)
  const shown: string[] = []
  const notifications: ReminderNotifications = {
    permission: 'granted',
    requestPermission: async () => { throw new Error('Scheduling must not prompt') },
    show: (_title, options) => { shown.push(options.tag!) },
  }
  const result = deliverWorkspaceReminders(workspace.getState(), due, notifications)
  assert.deepEqual(result, { receipts: [{ boardId: second, ids: [note.reminder!.id] }], nextAt, failed: false })
  for (const { boardId, ids } of result.receipts) workspace.markBoardRemindersNotified(boardId, ids)
  assert.equal(shown.length, 1)
  assert.deepEqual(open().getState().boards[second].notifiedReminders, [note.reminder!.id])

  workspace.wall.setState({ notifiedReminders: [] })
  const firstOnly = deliverWorkspaceReminders(workspace.getState(), due, notifications)
  assert.deepEqual(firstOnly.receipts, [{ boardId: FIRST_BOARD_ID, ids: [note.reminder!.id] }])
  assert.notEqual(shown[0], shown[1])
  workspace.markBoardRemindersNotified(FIRST_BOARD_ID, firstOnly.receipts[0].ids)
  const reloaded = open()
  assert.deepEqual(deliverWorkspaceReminders(reloaded.getState(), due, notifications).receipts, [])
  assert.deepEqual(deliverWorkspaceReminders(reloaded.getState(), nextAt, notifications).receipts, [
    { boardId: second, ids: ['upcoming'] },
  ])
  assert.deepEqual(deliverWorkspaceReminders(reloaded.getState(), nextAt, { ...notifications, permission: 'denied' }).receipts, [])
})

test('reminder undo, redo, and permanent deletion leave another board’s matching receipt intact', () => {
  const { open } = device(legacy)
  const workspace = open()
  const second = workspace.createBoard('Work')!
  workspace.switchBoard(second)
  workspace.wall.setState({ notes: [structuredClone(note)] })
  const state = workspace.wall.getState()
  state.markRemindersNotified([note.reminder!.id])
  state.setReminder(note.id)
  state.undo()
  assert.deepEqual(workspace.wall.getState().notes[0].reminder, note.reminder)
  state.redo()
  assert.equal(workspace.wall.getState().notes[0].reminder, undefined)
  assert.deepEqual(workspace.wall.getState().notifiedReminders, [note.reminder!.id])
  state.undo()
  state.archiveNote(note.id)
  state.permanentlyDeleteNote(note.id)
  assert.deepEqual(workspace.wall.getState().notes, [])
  assert.deepEqual(workspace.wall.getState().notifiedReminders, [])
  assert.deepEqual(open().getState().boards[FIRST_BOARD_ID].notifiedReminders, [note.reminder!.id])
})

test('malformed and unknown workspace versions are protected and the legacy board can still be opened', () => {
  const initial = device(legacy)
  const saved = initial.open().getState()
  const malformed = [
    '{bad',
    JSON.stringify({ ...saved, version: 9 }),
    JSON.stringify({ ...saved, boardOrder: [FIRST_BOARD_ID, FIRST_BOARD_ID] }),
    JSON.stringify({ ...saved, activeBoardId: 'unknown' }),
    JSON.stringify({ ...saved, boards: { [FIRST_BOARD_ID]: { ...saved.boards[FIRST_BOARD_ID], document: { notes: null, sections: [] } } } }),
  ]
  for (const raw of malformed) {
    const { data, health, open, writes } = device(legacy)
    data.set(WORKSPACE_STORAGE_KEY, raw)
    const workspace = open()
    assert.deepEqual(workspace.wall.getState().notes, document.notes)
    assert.equal(health.available, false)
    workspace.wall.getState().setWallName('A session-only edit')
    assert.equal(workspace.wall.getState().wallName, 'A session-only edit')
    assert.deepEqual(writes, [])
    assert.equal(data.get(WORKSPACE_STORAGE_KEY), raw)
    assert.equal(data.get(LEGACY_WALL_STORAGE_KEY), legacy)
  }
})

test('a corrupt legacy payload remains untouched and is never replaced with samples', () => {
  for (const raw of ['{bad', '{"version":7,"state":{"notes":[]}}', '{"version":1,"state":{"notes":[null]}}']) {
    const { data, health, open, writes } = device(raw)
    const workspace = open()
    workspace.wall.getState().setWallName('Session only')
    assert.equal(health.available, false)
    assert.deepEqual(writes, [])
    assert.equal(data.get(LEGACY_WALL_STORAGE_KEY), raw)
    assert.equal(data.has(WORKSPACE_STORAGE_KEY), false)
  }
})

test('failed migration and later failed saves keep work in memory and retry on the next durable edit', () => {
  const { data, health, open, read } = device(legacy)
  health.writesBlocked = true
  const workspace = open()
  assert.equal(health.available, false)
  assert.deepEqual(workspace.wall.getState().notes, document.notes)
  assert.equal(data.has(WORKSPACE_STORAGE_KEY), false)
  const second = workspace.createBoard('Draft board')!
  workspace.switchBoard(second)
  assert.equal(workspace.deleteBoard(FIRST_BOARD_ID), false)
  assert.equal(workspace.getState().boardOrder.length, 2)
  health.writesBlocked = false
  workspace.wall.getState().setWallName('Renamed draft')
  assert.equal(health.available, true)
  assert.equal(read().activeBoardId, second)
  assert.equal(read().boards[second].name, 'Renamed draft')
  assert.deepEqual(read().boards[FIRST_BOARD_ID].document, document)
  assert.equal(data.get(LEGACY_WALL_STORAGE_KEY), legacy)
})

test('board management under a storage failure keeps session edits and blocks deletion until the save can succeed', () => {
  const { health, open, read } = device(legacy)
  const workspace = open()
  const original = read()
  health.writesBlocked = true
  const second = workspace.createBoard('Draft')!
  assert.equal(workspace.stepBoard(1), true)
  assert.equal(workspace.renameBoard(second, 'Renamed draft'), true)
  assert.equal(workspace.wall.getState().wallName, 'Renamed draft')
  assert.equal(health.available, false)
  assert.equal(workspace.deleteBoard(second), false)
  assert.deepEqual(read(), original)
  assert.deepEqual(workspace.getState().boardOrder, [FIRST_BOARD_ID, second])

  health.writesBlocked = false
  assert.equal(workspace.renameBoard(second, 'Saved draft'), true)
  assert.equal(health.available, true)
  assert.equal(open().wall.getState().wallName, 'Saved draft')
  assert.equal(workspace.deleteBoard(second), true)
  assert.deepEqual(read(), original)
})

test('blocked reads cannot overwrite existing data after storage access returns', () => {
  const { health, open, read } = device(legacy)
  const saved = open().getState()
  health.readsBlocked = true
  const blocked = open()
  assert.equal(health.available, false)
  health.readsBlocked = false
  blocked.wall.getState().setWallName('Scratch edit')
  assert.deepEqual(read(), saved)
  assert.equal(health.available, false)
  assert.deepEqual(open().getState(), saved)
  assert.equal(health.available, true)
})

test('a stale tab cannot replace a workspace saved by another tab', () => {
  const { health, open, read } = device(legacy)
  const first = open()
  const stale = open()
  const second = first.createBoard('From the first tab')!
  stale.wall.getState().setWallName('Stale tab edit')
  assert.equal(health.available, false)
  assert.equal(stale.wall.getState().wallName, 'Stale tab edit')
  assert.equal(read().boards[FIRST_BOARD_ID].name, 'Original wall')
  assert.equal(read().boards[second].name, 'From the first tab')
})
