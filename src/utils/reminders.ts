import type { NoteReminder, StickyNoteData } from '../types/wall.ts'
import { isDueDate, localDay } from './taskDates.ts'

export function isReminderTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -62135596800000 && value <= 253402300799999
}

export function readReminder(value: unknown): NoteReminder | undefined {
  if (!value || typeof value !== 'object' || !('id' in value) || !('at' in value)) return
  if (typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 100 && isReminderTime(value.at)) {
    return { id: value.id, at: value.at }
  }
}

export function reminderInputValue(at: number) {
  const date = new Date(at)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${localDay(date)}T${hours}:${minutes}`
}

export function parseReminderInput(value: string): number | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
  if (!match || !isDueDate(match[1])) return
  const [year, month, day] = match[1].split('-').map(Number)
  const date = new Date(0)
  date.setFullYear(year, month - 1, day)
  date.setHours(Number(match[2]), Number(match[3]), 0, 0)
  const at = date.getTime()
  // During a spring-forward gap Date normalizes a nonexistent time to a later time.
  if (isReminderTime(at) && reminderInputValue(at) === value) return at
}

export function formatReminder(at: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(at)
}

export function listReminders(notes: StickyNoteData[]) {
  return notes.flatMap((note) => note.reminder && !note.archived && !note.completed
    ? [{ note, reminder: note.reminder }] : []).sort((a, b) => a.reminder.at - b.reminder.at)
}

export function reminderDelay(at: number, now = Date.now()) {
  return Math.min(2147483647, Math.max(0, at - now))
}

export type ReminderPermission = NotificationPermission | 'unavailable'

export interface ReminderNotifications {
  readonly permission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
  show: (title: string, options: NotificationOptions) => void
}

export function browserReminderNotifications(): ReminderNotifications | undefined {
  if (typeof window === 'undefined' || !window.isSecureContext || typeof window.Notification !== 'function') return
  const Notification = window.Notification
  return {
    get permission() { return Notification.permission },
    requestPermission: () => Notification.requestPermission(),
    show: (title, options) => { new Notification(title, options) },
  }
}

export async function requestReminderPermission(notifications?: ReminderNotifications): Promise<ReminderPermission> {
  if (!notifications) return 'unavailable'
  if (notifications.permission !== 'default') return notifications.permission
  try { return await notifications.requestPermission() }
  catch { return 'unavailable' }
}

export function deliverReminders(notes: StickyNoteData[], notified: string[], now: number, notifications?: ReminderNotifications) {
  const delivered: string[] = []
  let nextAt: number | undefined
  let failed = false
  if (notifications?.permission !== 'granted') return { delivered, nextAt, failed }
  const seen = new Set(notified)
  for (const { note, reminder } of listReminders(notes)) {
    if (seen.has(reminder.id)) continue
    if (reminder.at > now) { nextAt = reminder.at; break }
    if (notifications.permission !== 'granted') break
    try {
      notifications.show(note.title || 'Sticky note reminder', { tag: `wallflow-${reminder.id}`, body: 'A reminder from your WALLFLOW wall.' })
      delivered.push(reminder.id)
      seen.add(reminder.id)
    } catch {
      failed = true
      break
    }
  }
  return { delivered, nextAt, failed }
}
