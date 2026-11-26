import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Check, ChevronDown, ListChecks, Smile } from 'lucide-react'
import type { StickyNoteData } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { MAX_BODY_LENGTH, MAX_TITLE_LENGTH, NOTE_COLORS } from '../../utils/constants'
import { getEditorKeyAction } from '../../utils/noteEditorKeys'
import { getChecklistProgress } from '../../utils/noteTasks'
import { NoteTaskDetails } from './NoteTaskDetails'
import { NOTE_BODY_FONT, NOTE_TITLE_FONTS } from '../../utils/appearance'
import { insertNoteText, sketchMarker } from '../../utils/noteText'
import { isSketchId, SKETCHES } from '../../utils/sketches'
import type { SketchId } from '../../utils/sketches'
import { NoteArtworkPicker } from './NoteArtworkPicker'
import type { ArtworkPickerKind, SketchPlacement } from './NoteArtworkPicker'
import { NoteSketch } from './NoteSketch'

type TextField = 'title' | 'body'
type Cursor = { field: TextField; start: number; end: number }

export function NoteEditor({ note, anchor, registerAnchor }: {
  note: StickyNoteData; anchor: RefObject<HTMLDivElement | null>; registerAnchor: (node: HTMLDivElement | null) => void
}) {
  const titleInput = useRef<HTMLTextAreaElement>(null)
  const bodyInput = useRef<HTMLTextAreaElement>(null)
  const taskToggle = useRef<HTMLButtonElement>(null)
  const [tasksExpanded, setTasksExpanded] = useState(() => useWallStore.getState().showTaskDetails)
  const [picker, setPicker] = useState<ArtworkPickerKind | null>(null)
  const [feedback, setFeedback] = useState('')
  const savedCursor = useRef<Cursor>({ field: 'title', start: note.title.length, end: note.title.length })
  const nextCursor = useRef<Cursor | null>(null)
  const { paper, ink } = NOTE_COLORS[note.color]
  const usePhotoPaperLettering = useWallStore((state) => state.appearance.photoWorkspace !== undefined)
  const titleFont = NOTE_TITLE_FONTS[note.typography ?? 'handwritten']
  const sketchName = isSketchId(note.doodle) ? SKETCHES[note.doodle].name : note.doodle

  function remember(field: TextField, element: HTMLTextAreaElement) {
    savedCursor.current = { field, start: element.selectionStart, end: element.selectionEnd }
  }

  function closePicker(cursor = savedCursor.current) {
    nextCursor.current = cursor
    setPicker(null)
  }

  function insert(insertion: string, name: string, isSketch = false) {
    const { field, start, end } = savedCursor.current
    const label = field === 'title' ? 'title' : 'description'
    const current = useWallStore.getState().notes.find(({ id }) => id === note.id)
    if (!current) return
    const result = insertNoteText(current[field], start, end, insertion, field === 'title' ? MAX_TITLE_LENGTH : MAX_BODY_LENGTH)
    if (!result) {
      setFeedback(`The ${label} has no room for ${name}.`)
      closePicker()
      return
    }
    useWallStore.getState().writeNoteText(note.id, { [field]: result.value, ...(isSketch ? { inlineSketches: true } : {}) })
    setFeedback(`Added ${name} to the ${label}.`)
    closePicker({ field, start: result.cursor, end: result.cursor })
  }

  function selectSketch(id: SketchId, placement: SketchPlacement) {
    const { name } = SKETCHES[id]
    if (placement === 'inline') {
      insert(sketchMarker(id), name, true)
      return
    }
    useWallStore.getState().setNoteDoodle(note.id, id)
    setFeedback(`Placed ${name} in the corner.`)
    closePicker()
  }

  useLayoutEffect(() => {
    if (useWallStore.getState().showTaskDetails) {
      taskToggle.current?.focus({ preventScroll: true })
      return
    }
    const input = titleInput.current
    input?.focus({ preventScroll: true })
    if (input) input.setSelectionRange(input.value.length, input.value.length)
  }, [])
  useLayoutEffect(() => {
    const cursor = nextCursor.current
    if (picker || !cursor) return
    nextCursor.current = null
    const input = cursor.field === 'title' ? titleInput.current : bodyInput.current
    input?.focus({ preventScroll: true })
    input?.setSelectionRange(cursor.start, cursor.end)
    savedCursor.current = cursor
  }, [picker, note.title, note.body])

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
    onPointerDown={(event) => {
      if (picker && event.target instanceof Element && !event.target.closest('[data-note-artwork-panel], [data-note-artwork-trigger]')) setPicker(null)
    }}
    onBlur={(event) => {
      if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && useWallStore.getState().editingId === note.id) {
        useWallStore.getState().finishEditing()
      }
    }}
    onKeyDown={(event) => {
      const target = event.target as HTMLElement
      if (picker && event.key === 'Escape' && !event.nativeEvent.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        closePicker()
        return
      }
      if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && target.tagName !== 'TEXTAREA') return
      const action = getEditorKeyAction(event.nativeEvent)
      if (!action) return
      event.preventDefault()
      event.stopPropagation()
      useWallStore.getState().finishEditing(action === 'cancel-empty')
    }}>
    <textarea ref={titleInput} aria-label="Note title" className="inline-note-title" rows={2} maxLength={MAX_TITLE_LENGTH}
      style={{ fontFamily: titleFont }}
      onFocus={(event) => remember('title', event.currentTarget)}
      onSelect={(event) => remember('title', event.currentTarget)}
      onBlur={(event) => remember('title', event.currentTarget)}
      placeholder="Note title" value={note.title} onChange={(event) => useWallStore.getState().writeNoteText(note.id, { title: event.target.value })} />
    <textarea ref={bodyInput} aria-label="Note description" className="inline-note-body" rows={4} maxLength={MAX_BODY_LENGTH}
      style={{ fontFamily: usePhotoPaperLettering ? titleFont : NOTE_BODY_FONT }}
      onFocus={(event) => remember('body', event.currentTarget)}
      onSelect={(event) => remember('body', event.currentTarget)}
      onBlur={(event) => remember('body', event.currentTarget)}
      placeholder="Add a description" value={note.body} onChange={(event) => useWallStore.getState().writeNoteText(note.id, { body: event.target.value })} />
    <div className="note-artwork-tools" role="group" aria-label="Decorate note">
      <button data-note-artwork-trigger type="button" aria-expanded={picker === 'emoji'}
        onClick={() => picker === 'emoji' ? closePicker() : setPicker('emoji')}><Smile size={15} aria-hidden="true" /> Emoji</button>
      <button data-note-artwork-trigger type="button" aria-expanded={picker === 'symbols'}
        onClick={() => picker === 'symbols' ? closePicker() : setPicker('symbols')}><NoteSketch id="sparkles" size={17} /> Symbols</button>
    </div>
    {picker && <NoteArtworkPicker key={picker} kind={picker} doodle={note.doodle} close={() => closePicker()}
      insertEmoji={insert} selectSketch={selectSketch} removeSketch={() => {
        useWallStore.getState().setNoteDoodle(note.id)
        setFeedback('Removed the corner illustration.')
        closePicker()
      }} />}
    <button ref={taskToggle} type="button" className="note-task-toggle" aria-expanded={tasksExpanded} onClick={() => setTasksExpanded(!tasksExpanded)}>
      <ListChecks size={15} /><span>Task details</span>{note.checklist?.length ? <small>{getChecklistProgress(note.checklist)}</small> : null}<ChevronDown size={13} />
    </button>
    {tasksExpanded && <NoteTaskDetails note={note} />}
    <div className="note-artwork-preview">
      <span role="status">{feedback}</span>
      {note.doodle && <span className="note-corner-preview" role="img" aria-label={`Corner illustration, ${sketchName}`}>
        <NoteSketch id={note.doodle} size={43} />
      </span>}
    </div>
    <div className="inline-note-footer"><span className="editor-key-hint">Shift+Enter for a new line</span>
      <button type="button" onClick={() => useWallStore.getState().finishEditing()}><Check size={15} /> Done</button>
    </div>
  </div>
}
