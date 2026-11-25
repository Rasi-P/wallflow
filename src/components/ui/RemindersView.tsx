import { useEffect, useMemo, useState } from 'react'
import { Bell } from 'lucide-react'
import type { StickyNoteData } from '../../types/wall'
import { useWallStore } from '../../stores/wallStore'
import { browserReminderNotifications, formatReminder, listReminders, reminderDelay, requestReminderPermission } from '../../utils/reminders'
import { TaskNoteLink } from './TaskNoteLink'

export function RemindersView({ notes, onFocus }: { notes: StickyNoteData[]; onFocus: (id: string) => void }) {
  const [now, setNow] = useState(Date.now)
  const [requesting, setRequesting] = useState(false)
  const [requestFailed, setRequestFailed] = useState(false)
  const permission = useWallStore((state) => state.reminderPermission)
  const reminders = useMemo(() => listReminders(notes), [notes])
  const overdue = reminders.filter(({ reminder }) => reminder.at <= now)
  const upcoming = reminders.filter(({ reminder }) => reminder.at > now)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    function refresh() {
      clearTimeout(timer)
      const time = Date.now()
      setNow(time)
      const next = reminders.find(({ reminder }) => reminder.at > time)
      if (next) timer = setTimeout(refresh, reminderDelay(next.reminder.at, time))
    }
    refresh()
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [reminders])

  async function enable() {
    setRequesting(true)
    setRequestFailed(false)
    const result = await requestReminderPermission(browserReminderNotifications())
    if (result === 'unavailable') setRequestFailed(true)
    else useWallStore.getState().setReminderPermission(result)
    setRequesting(false)
  }

  return <>
    <div className="reminder-permission">
      {permission === 'default' && <button className="primary-button" type="button" disabled={requesting} onClick={() => void enable()}><Bell size={14} /> Enable notifications</button>}
      <p role="status">{permission === 'denied' ? 'Notifications are blocked in your browser settings.'
        : permission === 'unavailable' || requestFailed ? 'Browser notifications are unavailable. Reminders still appear here.'
          : permission === 'granted' ? 'Browser notifications are on.'
            : 'Enable browser notifications if you’d like an alert.'}</p>
      {permission !== 'unavailable' && <p>Keep WALLFLOW open to receive alerts.</p>}
    </div>
    <div className="task-panel-list">
      {!reminders.length && <p className="panel-empty">Set a reminder from a note’s task details.</p>}
      {[{ name: 'Overdue', rows: overdue }, { name: 'Upcoming', rows: upcoming }].map(({ name, rows }) => rows.length > 0 &&
        <div className="reminder-group" key={name}>
          <h3 className={name === 'Overdue' ? 'task-overdue' : undefined}>{name}</h3>
          {rows.map(({ note, reminder }) => <TaskNoteLink key={note.id} note={note} icon={<Bell size={14} />} onFocus={onFocus}>
            <span><time dateTime={new Date(reminder.at).toISOString()}>{formatReminder(reminder.at)}</time></span>
          </TaskNoteLink>)}
        </div>)}
    </div>
  </>
}
