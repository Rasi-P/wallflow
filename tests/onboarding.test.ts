import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { SAMPLE_NOTES } from '../src/utils/constants.ts'
import { TUTORIAL_STEPS } from '../src/utils/onboarding.ts'
import { LEGACY_WALL_STORAGE_KEY, WORKSPACE_STORAGE_KEY } from '../src/stores/workspaceStorage.ts'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (name: string) => memory.get(name) ?? null,
  setItem: (name: string, value: string) => { memory.set(name, value) },
} })
const { useWallStore: store, workspace } = await import('../src/stores/wallStore.ts')
const { handleWallShortcut } = await import('../src/hooks/useKeyboardShortcuts.ts')
const [sample, second] = SAMPLE_NOTES

beforeEach(() => {
  memory.clear()
  workspace.reload()
})

function press(key: string) {
  let prevented = false
  handleWallShortcut({ key, preventDefault: () => { prevented = true } } as KeyboardEvent)
  return prevented
}

test('a new wall offers setup and finishing with samples opens the optional walkthrough', () => {
  workspace.reload()
  assert.equal(store.getState().onboardingComplete, false)
  assert.equal(store.getState().tutorial, null)
  const before = store.getState().notes
  store.getState().completeOnboarding({ starter: 'samples' })
  assert.equal(store.getState().onboardingComplete, true)
  assert.equal(store.getState().tutorial, 'invite')
  assert.equal(store.getState().notes, before)
  const saved = JSON.parse(memory.get(WORKSPACE_STORAGE_KEY)!).boards[workspace.getState().activeBoardId]
  assert.equal(saved.preferences.onboardingComplete, true)
  assert.ok(!Object.hasOwn(saved, 'tutorial'))
})

test('setup shares the current appearance preferences and saves the choices for future notes', () => {
  const { setAppearance, setNoteDefaults, completeOnboarding } = store.getState()
  setAppearance({ shade: 'ivory', intensity: 90 })
  setNoteDefaults({ typography: 'sans', size: 'compact', rotation: 'straight' })
  completeOnboarding({ starter: 'samples', theme: 'study', color: 'violet' })
  workspace.reload()
  assert.deepEqual(store.getState().appearance, { theme: 'study', shade: 'ivory', intensity: 90, ambience: 'theme' })
  assert.deepEqual(store.getState().noteDefaults, { color: 'violet', typography: 'sans', size: 'compact', rotation: 'straight' })
  assert.deepEqual(store.getState().notes, SAMPLE_NOTES)
  store.getState().addNote()
  const first = store.getState().notes.at(-1)!
  assert.equal(first.color, 'violet')
  assert.equal(first.typography, 'sans')
  assert.equal(first.rotation, 0)
})

test('a fresh blank choice stays empty after refresh even if the invitation was open', () => {
  store.getState().completeOnboarding({ starter: 'blank' })
  assert.deepEqual(store.getState().notes, [])
  assert.equal(store.getState().tutorial, 'invite')
  workspace.reload()
  assert.deepEqual(store.getState().notes, [])
  assert.equal(store.getState().onboardingComplete, true)
  assert.equal(store.getState().tutorial, null)
  store.getState().completeOnboarding({ starter: 'samples' })
  assert.deepEqual(store.getState().notes, [])
})

test('blank setup removes only untouched sample notes and retains user notes and sections', () => {
  const { createSection, assignSection, updateNote, addNote, writeNoteText, completeOnboarding } = store.getState()
  const section = createSection('My ideas', [10, 7])!
  assignSection(sample.id, section)
  updateNote(second.id, { title: 'My edited plan', position: [2, -4] })
  addNote()
  const created = store.getState().editingId!
  writeNoteText(created, { title: 'My first note' })
  const before = store.getState()
  completeOnboarding({ starter: 'blank' })
  const after = store.getState()
  assert.equal(after.editingId, null)
  assert.equal(after.sections, before.sections)
  assert.deepEqual(after.notes, before.notes.filter((note) => [sample.id, second.id, created].includes(note.id)))
})

test('legacy saved walls bypass first-time setup, including an undismissed legacy welcome', () => {
  const notes = [{ ...sample, title: 'Keep my old note', position: [1, 3], sectionId: 'ideas' }]
  const sections = [{ id: 'ideas', name: 'Ideas', position: [6, 1] }]
  for (const welcomeDismissed of [false, true, undefined]) {
    memory.delete(WORKSPACE_STORAGE_KEY)
    memory.set(LEGACY_WALL_STORAGE_KEY, JSON.stringify({ version: 1, state: {
      welcomeDismissed, notes, sections, appearance: { theme: 'lab' }, noteDefaults: { color: 'blue' }, lighting: 'warm',
    } }))
    workspace.reload()
    const state = store.getState()
    assert.equal(state.onboardingComplete, true)
    assert.equal(state.tutorial, null)
    assert.deepEqual(state.notes, notes)
    assert.deepEqual(state.sections, sections)
    assert.equal(state.appearance.theme, 'lab')
    assert.equal(state.noteDefaults.color, 'blue')
    assert.equal(state.lighting, 'warm')
    state.completeOnboarding({ starter: 'blank', theme: 'studio', color: 'pink' })
    assert.equal(store.getState(), state)
  }
})

test('refresh keeps an unfinished first-time wall eligible for setup and preserves its draft work', () => {
  store.getState().updateNote(sample.id, { title: 'Started before setup' })
  workspace.reload()
  assert.equal(store.getState().onboardingComplete, false)
  assert.equal(store.getState().notes[0].title, 'Started before setup')
})

test('the tour supports back, next and finish without writing tutorial progress to storage', () => {
  const { completeOnboarding, startTutorial, moveTutorial } = store.getState()
  completeOnboarding({ starter: 'samples' })
  moveTutorial(1)
  assert.equal(store.getState().tutorial, 'invite')
  const saved = memory.get(WORKSPACE_STORAGE_KEY)
  startTutorial()
  moveTutorial(-1)
  assert.equal(store.getState().tutorial, 0)
  moveTutorial(1)
  assert.equal(store.getState().tutorial, 1)
  moveTutorial(-1)
  for (let index = 0; index < TUTORIAL_STEPS.length; index++) {
    assert.equal(store.getState().tutorial, index)
    moveTutorial(1)
  }
  assert.equal(store.getState().tutorial, null)
  assert.equal(memory.get(WORKSPACE_STORAGE_KEY), saved)
  workspace.reload()
  assert.equal(store.getState().onboardingComplete, true)
  assert.equal(store.getState().tutorial, null)
})

test('the invitation and active tour can be skipped and restarted from Help or Settings', () => {
  const { completeOnboarding, exitTutorial, setPanel, startTutorial, moveTutorial } = store.getState()
  completeOnboarding({ starter: 'blank' })
  exitTutorial()
  assert.equal(store.getState().tutorial, null)
  setPanel('helpOpen', true)
  startTutorial()
  assert.equal(store.getState().helpOpen, false)
  assert.equal(store.getState().tutorial, 0)
  moveTutorial(1)
  assert.equal(press('Escape'), true)
  assert.equal(store.getState().tutorial, null)
  setPanel('settingsOpen', true)
  startTutorial()
  assert.equal(store.getState().settingsOpen, false)
  assert.equal(store.getState().tutorial, 0)
  assert.deepEqual(store.getState().notes, [])
})

test('an active tour leaves note and camera shortcuts available', () => {
  store.getState().completeOnboarding({ starter: 'blank' })
  store.getState().startTutorial()
  assert.equal(press('n'), true)
  assert.equal(store.getState().notes.length, 1)
  assert.ok(store.getState().editingId)
  assert.equal(store.getState().tutorial, 0)
  press('Escape')
  assert.equal(store.getState().editingId, null)
  assert.equal(store.getState().tutorial, 0)
  press('0')
  assert.equal(store.getState().cameraCommand?.kind, 'reset')
})
