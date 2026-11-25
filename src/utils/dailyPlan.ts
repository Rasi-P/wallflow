import type { StickyNoteData } from '../types/wall.ts'
import { localDay } from './taskDates.ts'

export function listTodayNotes(notes: StickyNoteData[], today: string) {
  return notes.flatMap((note) => {
    if (note.archived) return []
    const dueToday = note.dueDate === today
    const overdue = Boolean(note.dueDate && note.dueDate < today && !note.completed)
    const planned = note.plannedOn === today || Boolean(note.checklist?.some((item) => item.plannedOn === today))
    const reminderToday = Boolean(note.reminder && !note.completed && localDay(new Date(note.reminder.at)) === today)
    return dueToday || overdue || planned || reminderToday ? [{ note, dueToday, overdue, planned, reminderToday }] : []
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || Number(b.dueToday) - Number(a.dueToday))
}

export function dailyProgress(notes: StickyNoteData[], today: string) {
  let total = 0
  let completed = 0
  for (const note of notes) {
    if (note.archived) continue
    if (note.plannedOn === today) {
      total++
      completed += Number(Boolean(note.completed))
    }
    for (const item of note.checklist ?? []) {
      if (item.plannedOn !== today) continue
      total++
      completed += Number(item.done)
    }
  }
  return { completed, total }
}
