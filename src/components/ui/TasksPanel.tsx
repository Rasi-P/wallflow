import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArchiveRestore, CalendarDays, Trash2, X } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { MAX_NOTES, NOTE_COLORS } from '../../utils/constants'
import { countActiveNotes, listDueNotes } from '../../utils/noteTasks'
import { dueStatus, formatDueDate } from '../../utils/taskDates'
import { IconButton } from './IconButton'
import { RemindersView } from './RemindersView'
import { TaskNoteLink } from './TaskNoteLink'
import { TodayView } from './TodayView'

export function TasksPanel() {
  const panel = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const notes = useWallStore((state) => state.notes)
  const today = useWallStore((state) => state.today)
  const archiveFocusId = useWallStore((state) => state.archiveFocusId)
  const [view, setView] = useState<'today' | 'deadlines' | 'reminders' | 'archive'>(() => archiveFocusId ? 'archive' : 'today')
  const archiveFocus = useRef<HTMLElement>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const due = useMemo(() => listDueNotes(notes), [notes])
  const archived = useMemo(() => notes.filter((note) => note.archived), [notes])
  const full = countActiveNotes(notes) >= MAX_NOTES
  const actions = useWallStore.getState()

  function close(returnFocus = false) {
    actions.setPanel('tasksOpen', false)
    if (returnFocus) document.getElementById('wall-task-panel-trigger')?.focus()
  }

  function focus(id: string) {
    close()
    actions.focusNote(id)
  }

  useLayoutEffect(() => {
    const row = archiveFocus.current
    if (row) { row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true }) }
    else closeButton.current?.focus({ preventScroll: true })
  }, [])
  useLayoutEffect(() => { if (confirmId) cancelDeleteButton.current?.focus() }, [confirmId])

  function cancelDeletion() {
    setConfirmId(null)
    deleteTrigger.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    function outside(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node && !panel.current?.contains(target) && !document.getElementById('wall-task-panel-trigger')?.contains(target)) {
        useWallStore.getState().setPanel('tasksOpen', false)
      }
    }
    window.addEventListener('pointerdown', outside, true)
    return () => window.removeEventListener('pointerdown', outside, true)
  }, [])

  return <section ref={panel} id="wall-task-panel" className="wall-task-panel" aria-label="Tasks" onKeyDown={(event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (confirmId) cancelDeletion()
    else close(true)
  }}>
    <div className="wall-task-panel-heading"><h2>Tasks</h2><IconButton ref={closeButton} label="Close tasks" onClick={() => close(true)}><X size={17} /></IconButton></div>
    <div className="task-panel-views" role="group" aria-label="Task views">
      <button type="button" aria-pressed={view === 'today'} onClick={() => { setView('today'); setConfirmId(null) }}>Today</button>
      <button type="button" aria-pressed={view === 'deadlines'} onClick={() => { setView('deadlines'); setConfirmId(null) }}>Deadlines</button>
      <button type="button" aria-pressed={view === 'reminders'} onClick={() => { setView('reminders'); setConfirmId(null) }}>Reminders</button>
      <button type="button" aria-pressed={view === 'archive'} onClick={() => setView('archive')}>Archive <span>{archived.length}</span></button>
    </div>
    <span className="sr-only" role="status">{announcement}</span>
    {view === 'today' && <TodayView notes={notes} today={today} onFocus={focus} />}
    {view === 'reminders' && <RemindersView notes={notes} onFocus={focus} />}
    {view === 'deadlines' && <div className="task-panel-list">
      {due.length === 0 && <p className="panel-empty">Add a due date in a note’s task details to see it here.</p>}
      {due.map((note) => {
        const date = note.dueDate!
        const status = dueStatus(date, today)
        return <TaskNoteLink key={note.id} note={note} icon={<CalendarDays size={15} />} onFocus={focus}>
          <span className={status === 'overdue' ? 'task-overdue' : undefined}>
            {status === 'overdue' ? 'Overdue · ' : status === 'today' ? 'Today · ' : ''}<time dateTime={date}>{formatDueDate(date, today)}</time>
          </span>
        </TaskNoteLink>
      })}
    </div>}
    {view === 'archive' && <div className="task-panel-list">
      {archived.length === 0 && <p className="panel-empty">Archived notes appear here until you restore or delete them.</p>}
      {full && archived.length > 0 && <p className="panel-empty">Make room on the wall to restore a note.</p>}
      {archived.map((note) => <article className="archived-note" key={note.id}
        ref={archiveFocusId === note.id ? archiveFocus : undefined} tabIndex={archiveFocusId === note.id ? -1 : undefined}>
        <div className="archived-note-row"><span className="task-paper-dot" style={{ background: NOTE_COLORS[note.color].paper }} />
          <span className="archived-note-title"><strong>{note.title || 'Untitled note'}</strong>{note.body && <small>{note.body}</small>}</span>
          <IconButton label={`Restore ${note.title || 'note'}`} data-tooltip="Restore note" disabled={full} onClick={() => {
            actions.restoreNote(note.id)
            if (archiveFocusId === note.id) { close(); actions.focusNote(note.id); return }
            if (confirmId === note.id) setConfirmId(null)
            closeButton.current?.focus({ preventScroll: true })
            setAnnouncement('Note restored to the wall.')
          }}><ArchiveRestore size={17} /></IconButton>
          <IconButton label={`Delete ${note.title || 'note'} permanently`} data-tooltip="Delete permanently" aria-expanded={confirmId === note.id}
            onClick={(event) => { deleteTrigger.current = event.currentTarget; setConfirmId(note.id) }}><Trash2 size={16} /></IconButton>
        </div>
        {confirmId === note.id && <div className="archive-confirm" role="group" aria-label="Confirm permanent deletion">
          <p>Delete <strong>{note.title || 'this note'}</strong> permanently?</p>
          <div><button type="button" ref={cancelDeleteButton} onClick={cancelDeletion}>Cancel</button>
            <button type="button" className="archive-delete" onClick={() => {
              actions.permanentlyDeleteNote(note.id)
              setConfirmId(null)
              closeButton.current?.focus({ preventScroll: true })
              setAnnouncement('Note permanently deleted.')
            }}>Delete permanently</button></div>
        </div>}
      </article>)}
    </div>}
  </section>
}
