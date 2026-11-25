import { useMemo, useState } from 'react'
import { CalendarCheck, ChevronDown, StickyNote } from 'lucide-react'
import type { StickyNoteData } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { dailyProgress, listTodayNotes } from '../../utils/dailyPlan'
import { DEFAULT_FILTERS, searchNotes } from '../../utils/noteSearch'
import { getChecklistProgress } from '../../utils/noteTasks'
import { formatDueDate } from '../../utils/taskDates'
import { TaskNoteLink } from './TaskNoteLink'

export function TodayView({ notes, today, onFocus }: { notes: StickyNoteData[]; today: string; onFocus: (id: string) => void }) {
  const [planning, setPlanning] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const entries = useMemo(() => listTodayNotes(notes, today), [notes, today])
  const { completed, total } = useMemo(() => dailyProgress(notes, today), [notes, today])
  const choices = useMemo(() => planning ? searchNotes(notes, query, DEFAULT_FILTERS, today) : [], [planning, notes, query, today])
  const actions = useWallStore.getState()

  function toggleChecklist(id: string) {
    setExpanded(expanded === id ? null : id)
  }
  return <>
    <div className="today-panel-controls">
      <div className="daily-progress">
        <span>{total ? `${completed}/${total} planned complete` : 'No items planned'}</span>
        {total > 0 && <progress aria-label="Daily plan progress" value={completed} max={total} />}
      </div>
      <button type="button" className="text-button today-plan-button" aria-pressed={planning} onClick={() => {
        setExpanded(null)
        setPlanning(!planning)
      }}><CalendarCheck size={15} /> {planning ? 'Back to Today' : 'Plan my day'}</button>
    </div>
    <div className="task-panel-list today-list">
      {planning ? <>
        <input className="today-plan-search" type="search" aria-label="Find a note to plan" placeholder="Find a note to plan…" value={query}
          onChange={(event) => setQuery(event.target.value)} />
        {choices.length === 0 && <p className="panel-empty">{query.trim() ? 'No matching notes on the wall.' : 'Add a note to start planning your day.'}</p>}
        {choices.map((note) => {
          const items = note.checklist ?? []
          const planned = items.filter((item) => item.plannedOn === today)
          return <article key={note.id} className="today-entry">
            <div className="today-note-row">
              <TaskNoteLink note={note} icon={<StickyNote size={15} />} onFocus={onFocus} />
              <label className="today-note-checkbox"><input type="checkbox" checked={note.plannedOn === today}
                aria-label={`Plan ${note.title || 'untitled note'} for today`} onChange={(event) => actions.setPlanned(note.id, event.target.checked)} /> Note</label>
            </div>
            {items.length > 0 && <button type="button" className="today-checklist-toggle" aria-expanded={expanded === note.id} onClick={() => toggleChecklist(note.id)}>
              <ChevronDown size={14} /> Checklist · {planned.length}/{items.length} planned
            </button>}
            {expanded === note.id && <ul className="today-checklist">
              {items.map((item) => <li key={item.id}><label>
                <input type="checkbox" checked={item.plannedOn === today} onChange={(event) => actions.setPlanned(note.id, event.target.checked, item.id)} />
                <span>{item.text || 'Untitled item'}</span>
              </label></li>)}
            </ul>}
          </article>
        })}
      </> : <>
        {!entries.length && <p className="panel-empty">Nothing due or planned. Use Plan my day to choose what to work on.</p>}
        {entries.map(({ note, overdue, dueToday, planned, reminderToday }) => {
          const items = note.checklist ?? []
          const visibleItems = expanded === note.id ? items : items.filter((item) => item.plannedOn === today)
          const status = [overdue && note.dueDate ? `Overdue · ${formatDueDate(note.dueDate, today)}` : dueToday ? 'Due today' : '',
            planned ? 'Planned' : '', reminderToday ? 'Reminder today' : ''].filter(Boolean).join(' · ')
          return <article className="today-entry" key={note.id}>
            <div className="today-note-row">
              <TaskNoteLink note={note} icon={<StickyNote size={15} />} onFocus={onFocus}>
                <span className={overdue ? 'task-overdue' : undefined}>{status}</span>
              </TaskNoteLink>
              <label className="today-note-checkbox"><input type="checkbox" checked={Boolean(note.completed)}
                aria-label={`Complete ${note.title || 'untitled note'}`} onChange={(event) => actions.updateTask(note.id, { completed: event.target.checked })} /> Done</label>
            </div>
            {visibleItems.length > 0 && <ul className="today-checklist">
              {visibleItems.map((item) => <li key={item.id}><label className={item.done ? 'is-done' : undefined}>
                <input type="checkbox" checked={item.done} onChange={() => actions.editChecklist(note.id, { kind: 'toggle', id: item.id })} />
                <span>{item.text || 'Untitled item'}</span>
              </label></li>)}
            </ul>}
            {items.some((item) => item.plannedOn !== today) && <button type="button" className="today-checklist-toggle"
              aria-expanded={expanded === note.id} onClick={() => toggleChecklist(note.id)}><ChevronDown size={14} /> Checklist · {getChecklistProgress(items)}</button>}
          </article>
        })}
      </>}
    </div>
  </>
}
