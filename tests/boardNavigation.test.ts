import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'

const memory = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => { memory.set(key, value) },
} })

const { useWallStore, workspace } = await import('../src/stores/wallStore.ts')
const { handleWallShortcut } = await import('../src/hooks/useKeyboardShortcuts.ts')

beforeEach(() => {
  memory.clear()
  workspace.reload()
  workspace.createBoard('Research')
})

function press(key: string, overrides: Partial<KeyboardEvent> = {}) {
  let handled = false
  handleWallShortcut({ key, target: null, preventDefault: () => { handled = true }, ...overrides } as KeyboardEvent)
  return handled
}

test('bracket keys step between boards and stop at either end', () => {
  const [first, research] = workspace.getState().boardOrder
  assert.equal(press('['), false)
  assert.equal(press(']'), true)
  assert.equal(workspace.getState().activeBoardId, research)
  assert.equal(press(']'), false)
  assert.equal(press('['), true)
  assert.equal(workspace.getState().activeBoardId, first)
})

test('board shortcuts ignore active text entry, composition, key repeats and modifiers', () => {
  const first = workspace.getState().activeBoardId
  const editableTargets = [
    { tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true },
  ]
  for (const target of editableTargets) assert.equal(press(']', { target: target as HTMLElement }), false)
  for (const flag of ['isComposing', 'repeat', 'ctrlKey', 'metaKey', 'altKey', 'shiftKey', 'defaultPrevented']) {
    assert.equal(press(']', { [flag]: true }), false, flag)
  }
  assert.equal(workspace.getState().activeBoardId, first)
})

test('board shortcuts ignore editing, drags, and the existing task, search, help and settings panels', () => {
  const first = workspace.getState().activeBoardId
  const wall = useWallStore.getState()
  const note = wall.notes[0]
  wall.editNote(note.id)
  assert.equal(press(']'), false)
  assert.equal(useWallStore.getState().editingId, note.id)
  wall.finishEditing()
  wall.setDragging(note.id)
  assert.equal(press(']'), false)
  wall.setDragging(null)
  for (const panel of ['tasksOpen', 'searchOpen', 'helpOpen', 'settingsOpen'] as const) {
    wall.setPanel(panel, true)
    assert.equal(press(']'), false)
    wall.setPanel(panel, false)
  }
  assert.equal(workspace.getState().activeBoardId, first)
})

test('board navigation stays outside dialogs and board management guards other wall shortcuts', () => {
  const first = workspace.getState().activeBoardId
  const genericDialogButton = { tagName: 'BUTTON', closest: (query: string) => query.includes('[role="dialog"]') ? {} : null } as HTMLElement
  assert.equal(press(']', { target: genericDialogButton }), false)
  const managementButton = { tagName: 'BUTTON', closest: (query: string) => query === '.board-management-dialog' ? {} : null } as HTMLElement
  const captureButton = { tagName: 'BUTTON', closest: (query: string) => query === '.capture-dialog' ? {} : null } as HTMLElement
  for (const target of [managementButton, captureButton]) {
    for (const key of [']', 'n', 'delete']) assert.equal(press(key, { target }), false)
  }
  assert.equal(workspace.getState().activeBoardId, first)
  assert.equal(useWallStore.getState().editingId, null)
})
