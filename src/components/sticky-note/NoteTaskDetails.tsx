import { useState } from 'react'
import { ChevronDown, ChevronUp, Plus, X } from 'lucide-react'
import type { StickyNoteData, TaskPriority } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { getChecklistProgress, MAX_CHECKLIST_ITEMS, MAX_ITEM_LENGTH, PRIORITY_LABELS } from '../../utils/noteTasks'
import { dueStatus } from '../../utils/taskDates'
import { ReminderField } from './ReminderField'

export function NoteTaskDetails({ note }: { note: StickyNoteData }) {
  const [draft, setDraft] = useState('')
  const today = useWallStore((state) => state.today)
  const actions = useWallStore.getState()
  const items = note.checklist ?? []
  const full = items.length >= MAX_CHECKLIST_ITEMS
  function addItem() {
    if (!draft.trim() || full) return
    actions.editChecklist(note.id, { kind: 'add', text: draft })
    setDraft('')
  }

  return <div className="note-task-details">
    <div className="note-task-fields">
      <label><span>Priority</span><select value={note.priority ?? ''}
        onChange={(event) => actions.updateTask(note.id, { priority: (event.target.value || undefined) as TaskPriority | undefined })}>
        <option value="">No priority</option>
        {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label><span>Due date</span><input type="date" value={note.dueDate ?? ''}
        onChange={(event) => actions.updateTask(note.id, { dueDate: event.target.value || undefined })} /></label>
      {note.dueDate && <button type="button" className="task-mini-button task-clear-date" aria-label="Remove due date"
        onClick={() => actions.updateTask(note.id, { dueDate: undefined })}><X size={15} /></button>}
    </div>
    <div className="note-task-status">
      <label><input type="checkbox" checked={Boolean(note.completed)} onChange={(event) => actions.updateTask(note.id, { completed: event.target.checked })} /> Note complete</label>
      {note.dueDate && !note.completed && dueStatus(note.dueDate, today) === 'overdue' && <span className="task-overdue">Overdue</span>}
    </div>
    <ReminderField note={note} />
    <div className="checklist-heading"><span>Checklist</span><output aria-label="Checklist progress">{getChecklistProgress(items)}</output></div>
    <ul className="note-checklist">
      {items.map((item, index) => <li key={item.id} className="checklist-row">
        <input type="checkbox" checked={item.done} aria-label={`Complete checklist item ${index + 1}`}
          onChange={() => actions.editChecklist(note.id, { kind: 'toggle', id: item.id })} />
        <input type="text" className={item.done ? 'checklist-text is-done' : 'checklist-text'} aria-label={`Checklist item ${index + 1}`}
          value={item.text} maxLength={MAX_ITEM_LENGTH} onChange={(event) => actions.editChecklist(note.id, { kind: 'edit', id: item.id, text: event.target.value })} />
        <button type="button" className="task-mini-button" aria-label={`Move item ${index + 1} up`} disabled={index === 0}
          onClick={() => actions.editChecklist(note.id, { kind: 'move', id: item.id, direction: -1 })}><ChevronUp size={15} /></button>
        <button type="button" className="task-mini-button" aria-label={`Move item ${index + 1} down`} disabled={index === items.length - 1}
          onClick={() => actions.editChecklist(note.id, { kind: 'move', id: item.id, direction: 1 })}><ChevronDown size={15} /></button>
        <button type="button" className="task-mini-button" aria-label={`Delete item ${index + 1}`}
          onClick={() => actions.editChecklist(note.id, { kind: 'delete', id: item.id })}><X size={15} /></button>
      </li>)}
    </ul>
    <div className="checklist-add">
      <input type="text" aria-label="New checklist item" placeholder={full ? 'Checklist is full' : 'Add an item…'} disabled={full}
        value={draft} maxLength={MAX_ITEM_LENGTH} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.nativeEvent.isComposing) return
          event.preventDefault()
          event.stopPropagation()
          addItem()
        }} />
      <button type="button" className="task-mini-button" aria-label="Add checklist item" disabled={full || !draft.trim()} onClick={addItem}><Plus size={17} /></button>
    </div>
  </div>
}
