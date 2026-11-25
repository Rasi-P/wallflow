import { useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import type { StickyNoteData } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { formatReminder, parseReminderInput, reminderInputValue } from '../../utils/reminders'

export function ReminderField({ note }: { note: StickyNoteData }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const reminder = note.reminder
  const label = reminder ? formatReminder(reminder.at) : 'Set reminder'
  function close() {
    setEditing(false)
    trigger.current?.focus({ preventScroll: true })
  }
  function save() {
    // Keep the exact instant when the displayed time was left unchanged.
    const at = reminder && value === reminderInputValue(reminder.at) ? reminder.at : parseReminderInput(value)
    if (at === undefined) {
      setError(true)
      return
    }
    useWallStore.getState().setReminder(note.id, at)
    close()
  }
  return <div className="note-reminder">
    <button ref={trigger} type="button" className="note-reminder-toggle" aria-expanded={editing}
      aria-label={reminder ? `Edit reminder, ${label}` : undefined} onClick={() => {
      setValue(reminder ? reminderInputValue(reminder.at) : '')
      setError(false)
      setEditing(!editing)
    }}>
      <Bell size={14} />{label}
    </button>
    {editing && <div className="note-reminder-editor">
      <label>Reminder date and time<input type="datetime-local" value={value} aria-invalid={error || undefined}
        onChange={(event) => { setValue(event.target.value); setError(false) }} onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            save()
          }
        }} /></label>
      {error && <p className="task-overdue" role="alert">Enter a valid date and time in your time zone.</p>}
      <div className="note-reminder-actions">
        {reminder && <button type="button" onClick={() => { useWallStore.getState().setReminder(note.id); close() }}>Remove</button>}
        <button type="button" onClick={save} disabled={!value}>Save reminder</button>
      </div>
    </div>}
  </div>
}
