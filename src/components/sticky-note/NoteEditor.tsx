import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Check, ChevronDown, ListChecks } from 'lucide-react'
import type { StickyNoteData } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH, NOTE_COLORS } from '../../utils/constants'
import { getEditorKeyAction } from '../../utils/noteEditorKeys'
import { getChecklistProgress } from '../../utils/noteTasks'
import { NoteTaskDetails } from './NoteTaskDetails'

export function NoteEditor({ note, anchor, registerAnchor }: {
  note: StickyNoteData; anchor: RefObject<HTMLDivElement | null>; registerAnchor: (node: HTMLDivElement | null) => void
}) {
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const taskToggle = useRef<HTMLButtonElement>(null)
  const [tasksExpanded, setTasksExpanded] = useState(() => useWallStore.getState().showTaskDetails)
  const { paper, ink } = NOTE_COLORS[note.color]
  useLayoutEffect(() => {
    if (useWallStore.getState().showTaskDetails) {
      taskToggle.current?.focus({ preventScroll: true })
      return
    }
    const input = titleInput.current
    input?.focus({ preventScroll: true })
    if (input) input.setSelectionRange(input.value.length, input.value.length)
  }, [])
  useEffect(() => {
    function finishOutside(event: PointerEvent) {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && useWallStore.getState().editingId === note.id) {
        useWallStore.getState().finishEditing()
      }
    }
    window.addEventListener('pointerdown', finishOutside, true)
    return () => window.removeEventListener('pointerdown', finishOutside, true)
  }, [anchor, note.id])

  return <div ref={registerAnchor} className="inline-note-editor" role="group" aria-label="Edit sticky note"
    style={{ backgroundColor: paper, color: ink }}
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && useWallStore.getState().editingId === note.id) {
        useWallStore.getState().finishEditing()
      }
    }}
    onKeyDown={(event) => {
      const target = event.target as HTMLElement
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && target.tagName !== 'TEXTAREA') return
      const action = getEditorKeyAction(event.nativeEvent)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      useWallStore.getState().finishEditing(action === 'cancel-empty')
    }}>
    <textarea ref={titleInput} aria-label="Note title" className="inline-note-title" rows={2} maxLength={MAX_TITLE_LENGTH}
      placeholder="Note title" value={note.title} onChange={(event) => useWallStore.getState().writeNoteText(note.id, { title: event.target.value })} />
    <textarea aria-label="Note description" className="inline-note-body" rows={4} maxLength={MAX_BODY_LENGTH}
      placeholder="Add a description" value={note.body} onChange={(event) => useWallStore.getState().writeNoteText(note.id, { body: event.target.value })} />
    <button ref={taskToggle} type="button" className="note-task-toggle" aria-expanded={tasksExpanded} onClick={() => setTasksExpanded(!tasksExpanded)}>
      <ListChecks size={15} /><span>Task details</span>{note.checklist?.length ? <small>{getChecklistProgress(note.checklist)}</small> : null}<ChevronDown size={13} />
    </button>
    {tasksExpanded && <NoteTaskDetails note={note} />}
    <div className="inline-note-footer"><span className="editor-key-hint">Shift+Enter for a new line</span>
      <button type="button" onClick={() => useWallStore.getState().finishEditing()}><Check size={15} /> Done</button>
    </div>
  </div>
}
