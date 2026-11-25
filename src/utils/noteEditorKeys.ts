type EditorKey = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing'>

export function getEditorKeyAction(event: EditorKey) {
  if (event.isComposing) return null
  if (event.key === 'Escape') return 'cancel-empty'
  if (event.key === 'Enter' && !event.altKey && (!event.shiftKey || event.metaKey || event.ctrlKey)) return 'finish'
  return null
}
