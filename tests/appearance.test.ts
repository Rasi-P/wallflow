import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { EnvironmentTheme, StickyNoteData } from '../src/types/wall.ts'
import { DEFAULT_APPEARANCE, DEFAULT_NOTE_PREFERENCES, environmentLighting, MAX_LIGHT_INTENSITY,
  MIN_LIGHT_INTENSITY, NOTE_SIZE_SCALES, THEME_PRESETS, wallFinish } from '../src/utils/appearance.ts'
import { NOTE_HEIGHT, NOTE_WIDTH, SAMPLE_NOTES } from '../src/utils/constants.ts'
import { LEGACY_WALL_STORAGE_KEY } from '../src/stores/workspaceStorage.ts'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (name: string) => memory.get(name) ?? null,
  setItem: (name: string, value: string) => { memory.set(name, value) },
} })
const { useWallStore: store, workspace, registerVisibleNoteSlots } = await import('../src/stores/wallStore.ts')
const [sample, other] = SAMPLE_NOTES

beforeEach(() => {
  memory.clear()
  workspace.reload()
})

test('selecting each environment persists the theme and appearance overrides', () => {
  store.getState().setAppearance({ shade: 'mist', intensity: 110, ambience: 'airy' })
  for (const theme of Object.keys(THEME_PRESETS) as EnvironmentTheme[]) {
    store.getState().setAppearance({ theme })
    workspace.reload()
    assert.deepEqual(store.getState().appearance, { theme, shade: 'mist', intensity: 110, ambience: 'airy' })
  }
  assert.equal(new Set(Object.keys(THEME_PRESETS).map((theme) => wallFinish({
    ...DEFAULT_APPEARANCE, theme: theme as EnvironmentTheme,
  }).color)).size, Object.keys(THEME_PRESETS).length)
  assert.equal(environmentLighting(DEFAULT_APPEARANCE, 'daylight').key, 2.35)
  assert.equal(environmentLighting(DEFAULT_APPEARANCE, 'warm').background, '#eee6da')
  assert.equal(environmentLighting({ ...DEFAULT_APPEARANCE, theme: 'lab' }, 'daylight').keyColor, '#f2f8ff')
  assert.ok(environmentLighting({ ...DEFAULT_APPEARANCE, ambience: 'airy' }, 'daylight').ambient > 0.72)
})

test('invalid saved preferences fall back individually and light intensity is bounded', () => {
  memory.set(LEGACY_WALL_STORAGE_KEY, JSON.stringify({ version: 1, state: {
    notes: [{ ...sample, typography: 'bad' }],
    appearance: { theme: 'toString', shade: 'black', intensity: 10000, ambience: false },
    noteDefaults: { color: 'constructor', typography: ['sans'], size: 900, rotation: 'wild' },
  } }))
  workspace.reload()
  const state = store.getState()
  assert.deepEqual(state.appearance, { ...DEFAULT_APPEARANCE, intensity: MAX_LIGHT_INTENSITY })
  assert.deepEqual(state.noteDefaults, DEFAULT_NOTE_PREFERENCES)
  assert.deepEqual(state.notes, [sample])
  state.setAppearance({ intensity: -10 })
  assert.equal(store.getState().appearance.intensity, MIN_LIGHT_INTENSITY)
  state.setAppearance({ intensity: Number.NaN })
  assert.equal(store.getState().appearance.intensity, 100)
})

test('new notes use the configured color, font, size, and straight rotation independently of selection', () => {
  const { setNoteDefaults, addNote, finishEditing, select } = store.getState()
  setNoteDefaults({ color: 'violet', typography: 'sans', size: 'large', rotation: 'straight' })
  select(other.id)
  addNote()
  finishEditing()
  const first = store.getState().notes.at(-1)!
  const scale = NOTE_SIZE_SCALES.large
  assert.deepEqual(first.size, [NOTE_WIDTH * scale, NOTE_HEIGHT * scale])
  assert.equal(first.color, 'violet')
  assert.equal(first.typography, 'sans')
  assert.equal(first.rotation, 0)
  workspace.reload()
  assert.deepEqual(store.getState().notes.at(-1), first)
  assert.deepEqual(store.getState().noteDefaults, { color: 'violet', typography: 'sans', size: 'large', rotation: 'straight' })
})

test('varied rotation is small and paper size is considered when picking open space', (t) => {
  store.setState({ notes: [{ ...sample, position: [0, 0], rotation: 0 }] })
  const { setNoteDefaults, addNote, finishEditing } = store.getState()
  setNoteDefaults({ size: 'large' })
  let random = 0.75
  t.mock.method(Math, 'random', () => random)
  const unregister = registerVisibleNoteSlots(() => [[2.9, 0], [6, 0]])
  try { addNote() } finally { unregister() }
  const created = store.getState().notes.at(-1)!
  assert.equal(created.rotation, 0.027)
  assert.deepEqual(created.position, [6, 0])
  finishEditing()
  random = 0.1
  addNote()
  assert.ok(store.getState().notes.at(-1)!.rotation < 0)
})

test('changing defaults never rewrites existing notes or their history', () => {
  const { setNoteDefaults, setAppearance, finishEditing, addNote, duplicateNote } = store.getState()
  setNoteDefaults({ color: 'blue', typography: 'sans', size: 'compact', rotation: 'straight' })
  addNote()
  finishEditing()
  const before = store.getState()
  const existing = before.notes.at(-1)!
  setNoteDefaults({ color: 'pink', typography: 'handwritten', size: 'large', rotation: 'varied' })
  setAppearance({ theme: 'study' })
  const after = store.getState()
  assert.equal(after.notes, before.notes)
  assert.equal(after.past, before.past)
  assert.deepEqual(after.notes.slice(0, SAMPLE_NOTES.length), SAMPLE_NOTES)
  duplicateNote(existing.id)
  const copy = store.getState().notes.at(-1)!
  assert.equal(copy.typography, 'sans')
  assert.equal(copy.color, 'blue')
  assert.equal(copy.rotation, 0)
  assert.deepEqual(copy.size, existing.size)
})

test('toolbar swatches change the selected paper or update the default with no selection', () => {
  const { chooseColor, select, addNote, finishEditing } = store.getState()
  chooseColor('green')
  assert.equal(store.getState().noteDefaults.color, 'green')
  select(sample.id)
  chooseColor('pink')
  assert.equal(store.getState().notes[0].color, 'pink')
  assert.equal(store.getState().noteDefaults.color, 'green')
  addNote()
  finishEditing()
  assert.equal(store.getState().notes.at(-1)!.color, 'green')
})

test('reset restores theme and note defaults without resetting the wall or notes', () => {
  const { setAppearance, setNoteDefaults, setLighting, setWallName, setShowHints, rotateWall, createSection, resetAppearance } = store.getState()
  setAppearance({ theme: 'studio', ambience: 'quiet', shade: 'ivory', intensity: 90 })
  setNoteDefaults({ color: 'blue', typography: 'sans', size: 'compact', rotation: 'straight' })
  setLighting('warm')
  setWallName('Research board')
  setShowHints(false)
  rotateWall([12, -9])
  createSection('Drafts', [7, 2])
  const before = store.getState()
  resetAppearance()
  assert.equal(store.getState().notes, before.notes)
  assert.equal(store.getState().sections, before.sections)
  assert.equal(store.getState().past, before.past)
  workspace.reload()
  const after = store.getState()
  assert.deepEqual(after.appearance, DEFAULT_APPEARANCE)
  assert.deepEqual(after.noteDefaults, DEFAULT_NOTE_PREFERENCES)
  assert.equal(after.lighting, 'daylight')
  assert.equal(after.wallName, before.wallName)
  assert.equal(after.showHints, false)
  assert.deepEqual(after.wallRotation, before.wallRotation)
  assert.deepEqual(after.notes, before.notes)
  assert.deepEqual(after.sections, before.sections)
})

test('older walls retain the default theme ID, their lighting, and note and planning data', () => {
  const section = { id: 'work', name: 'Work', position: [7, 2] }
  const old: StickyNoteData = {
    ...sample, position: [7, 2], size: [3.1, 3.4], rotation: 0.31, sectionId: section.id,
    dueDate: '2026-12-01', plannedOn: '2026-11-26', completed: true, archived: true, priority: 'high',
    checklist: [{ id: 'check', text: 'Send draft', done: true, plannedOn: '2026-11-26' }],
    reminder: { id: 'due', at: Date.UTC(2026, 11, 1) },
  }
  memory.set(LEGACY_WALL_STORAGE_KEY, JSON.stringify({ version: 1, state: {
    notes: [old, other], sections: [section], lighting: 'warm', showHints: false, wallName: 'Old wall',
    wallRotation: [3, -7], notifiedReminders: ['due'],
  } }))
  workspace.reload()
  const state = store.getState()
  assert.deepEqual(state.appearance, DEFAULT_APPEARANCE)
  assert.deepEqual(state.noteDefaults, DEFAULT_NOTE_PREFERENCES)
  assert.deepEqual(state.notes, [old, other])
  assert.deepEqual(state.sections, [section])
  assert.deepEqual(state.wallRotation, [3, -7])
  assert.deepEqual(state.notifiedReminders, ['due'])
  assert.equal(state.lighting, 'warm')
  assert.equal(state.showHints, false)
  assert.equal(state.wallName, 'Old wall')
})
