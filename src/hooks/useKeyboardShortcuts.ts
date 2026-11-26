import { useEffect } from 'react'
import { useWallStore, workspace } from '../stores/wallStore.ts'

export function handleWallShortcut(event: KeyboardEvent) {
  const state = useWallStore.getState()
  const target = event.target as HTMLElement | null
  const typing = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
  if (event.defaultPrevented || event.isComposing || typing || state.draggingId) return
  if (target?.closest?.('.board-management-dialog') ||
    (typeof document !== 'undefined' && document.querySelector('dialog.board-management-dialog[open]'))) return
  const key = event.key.toLowerCase()
  const modifier = event.metaKey || event.ctrlKey
  if (state.editingId) {
    if (key === 'escape') { event.preventDefault(); state.finishEditing(true) }
    return
  }
  if (state.tasksOpen) {
    if (key === 'escape') { event.preventDefault(); state.setPanel('tasksOpen', false) }
    return
  }
  if (modifier && key === 'k' && !state.settingsOpen && !state.helpOpen) {
    event.preventDefault(); state.setPanel('searchOpen', !state.searchOpen); return
  }
  if (state.settingsOpen || state.searchOpen || state.helpOpen || event.altKey) return
  if (modifier) {
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      if (key === 'y' || event.shiftKey) state.redo()
      else state.undo()
    } else if (key === 'd' && !event.shiftKey && state.selectedId) {
      event.preventDefault()
      if (!event.repeat) state.duplicateNote(state.selectedId)
    }
    return
  }
  switch (key) {
    case '[': case ']':
      if (event.shiftKey || event.repeat || target?.closest?.('dialog, [role="dialog"], [role="alertdialog"]') ||
        (typeof document !== 'undefined' && document.querySelector('dialog[open]'))) return
      if (workspace.stepBoard(key === '[' ? -1 : 1)) event.preventDefault()
      break
    case 'n':
      if (!event.repeat) { event.preventDefault(); state.addNote() }
      break
    case 'v': state.setMode('select'); break
    case 'h': state.setMode('pan'); break
    case 'o': state.setMode('orbit'); break
    case '0': state.commandCamera('reset'); break
    case 'f':
      if (state.selectedId) { event.preventDefault(); state.focusNote(state.selectedId) }
      break
    case '+': case '=': state.commandCamera('zoom', 1 / 1.2); break
    case '-': state.commandCamera('zoom', 1.2); break
    case 'escape':
      if (state.tutorial !== null) { event.preventDefault(); state.exitTutorial() }
      else state.select(null)
      break
    case 'enter':
      if (state.selectedId && !event.repeat && !target?.closest?.('button, a, [role="button"]')) {
        event.preventDefault(); state.editNote(state.selectedId)
      }
      break
    case 'delete': case 'backspace':
      if (state.selectedId) { event.preventDefault(); state.deleteNote(state.selectedId) }
      break
    case '?': state.setPanel('helpOpen', true); break
  }
}

export function useKeyboardShortcuts() {
  useEffect(() => {
    window.addEventListener('keydown', handleWallShortcut)
    return () => window.removeEventListener('keydown', handleWallShortcut)
  }, [])
}
