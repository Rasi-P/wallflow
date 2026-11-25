import type { ChecklistItem, NoteTaskFields, StickyNoteData, TaskPriority } from '../types/wall.ts'
import { dueStatus, formatDueDate, isDueDate } from './taskDates.ts'

export const MAX_CHECKLIST_ITEMS = 24
export const MAX_ITEM_LENGTH = 120
export const PRIORITY_LABELS: Record<TaskPriority, string> = { low: 'Low', medium: 'Medium', high: 'High' }
export const isPriority = (value: unknown): value is TaskPriority => value === 'low' || value === 'medium' || value === 'high'

export const countActiveNotes = (notes: StickyNoteData[]) => notes.reduce((count, note) => count + Number(!note.archived), 0)

export function restoreTaskFields(note: StickyNoteData, record: Record<string, unknown>) {
  if (isPriority(record.priority)) note.priority = record.priority
  if (isDueDate(record.dueDate)) note.dueDate = record.dueDate
  if (record.completed === true) note.completed = true
  if (record.archived === true) note.archived = true
  if (!Array.isArray(record.checklist)) return
  const items: ChecklistItem[] = []
  const ids = new Set<string>()
  for (const item of record.checklist) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id || ids.has(item.id) || typeof item.text !== 'string') continue
    const restored: ChecklistItem = { id: item.id, text: item.text.slice(0, MAX_ITEM_LENGTH), done: item.done === true }
    if (isDueDate(item.plannedOn)) restored.plannedOn = item.plannedOn
    items.push(restored)
    ids.add(item.id)
    if (items.length >= MAX_CHECKLIST_ITEMS) break
  }
  if (items.length) note.checklist = items
}

export type ChecklistChange = { kind: 'add'; text: string } | { kind: 'edit'; id: string; text: string }
  | { kind: 'toggle' | 'delete'; id: string } | { kind: 'move'; id: string; direction: -1 | 1 }

export function changeChecklist(items: ChecklistItem[], change: ChecklistChange) {
  if (change.kind === 'add') {
    const text = change.text.trim().slice(0, MAX_ITEM_LENGTH)
    return text && items.length < MAX_CHECKLIST_ITEMS ? [...items, { id: crypto.randomUUID(), text, done: false }] : items
  }
  const index = items.findIndex((item) => item.id === change.id)
  if (index < 0) return items
  const result = [...items]
  switch (change.kind) {
    case 'edit': {
      const text = change.text.slice(0, MAX_ITEM_LENGTH)
      if (text === items[index].text) return items
      result[index] = { ...items[index], text }
      break
    }
    case 'toggle': result[index] = { ...items[index], done: !items[index].done }; break
    case 'delete': result.splice(index, 1); break
    case 'move': {
      const destination = index + change.direction
      if (destination < 0 || destination >= items.length) return items
      result[index] = items[destination]
      result[destination] = items[index]
      break
    }
  }
  return result
}

export function getChecklistProgress(items: ChecklistItem[] = []) {
  return `${items.filter(({ done }) => done).length}/${items.length}`
}

export function hasTaskDetails(note: NoteTaskFields) {
  return Boolean(note.checklist?.length || note.priority || note.dueDate || note.completed)
}

export function listDueNotes(notes: StickyNoteData[]) {
  return notes.filter((note) => !note.archived && !note.completed && note.dueDate)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!))
}

export interface TaskInk {
  rows: Array<Pick<ChecklistItem, 'text' | 'done'>>
  summary: string
  due: string
  overdue: boolean
}

export function getTaskInk(note: NoteTaskFields, today: string): TaskInk | undefined {
  if (!hasTaskDetails(note)) return undefined
  const status = note.completed || !note.dueDate ? undefined : dueStatus(note.dueDate, today)
  return {
    rows: (note.checklist ?? []).slice(0, 3).map(({ text, done }) => ({ text, done })),
    summary: [note.completed ? 'Complete' : '', note.checklist?.length ? `${getChecklistProgress(note.checklist)} checked` : '',
      note.priority ? `${PRIORITY_LABELS[note.priority]} priority` : ''].filter(Boolean).join('  ·  '),
    due: note.dueDate ? `${status === 'overdue' ? 'OVERDUE' : status === 'today' ? 'Due today' : 'Due'}  ${formatDueDate(note.dueDate, today)}` : '',
    overdue: status === 'overdue',
  }
}
