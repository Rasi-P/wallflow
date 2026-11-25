import type { StickyNoteData, TaskPriority } from '../types/wall.ts'
import { dueStatus } from './taskDates.ts'

export interface WallFilters {
  priority: 'any' | 'none' | TaskPriority
  completion: 'any' | 'open' | 'completed'
  due: 'any' | 'none' | ReturnType<typeof dueStatus>
  section: string | null
  archive: 'active' | 'archived' | 'all'
}

// A null section means any section; an empty ID means unassigned.
export const DEFAULT_FILTERS: WallFilters = { priority: 'any', completion: 'any', due: 'any', section: null, archive: 'active' }

export function hasWallFilters(filters: WallFilters) {
  return filters.priority !== 'any' || filters.completion !== 'any' || filters.due !== 'any' ||
    filters.section !== null || filters.archive !== 'active'
}

export function matchesFilters(note: StickyNoteData, filters: WallFilters, today: string) {
  return (filters.archive === 'all' || Boolean(note.archived) === (filters.archive === 'archived')) &&
    (filters.priority === 'any' || (note.priority ?? 'none') === filters.priority) &&
    (filters.completion === 'any' || Boolean(note.completed) === (filters.completion === 'completed')) &&
    (filters.due === 'any' || (note.dueDate ? dueStatus(note.dueDate, today) : 'none') === filters.due) &&
    (filters.section === null || (note.sectionId ?? '') === filters.section)
}

export function searchNotes(notes: StickyNoteData[], query: string, filters: WallFilters, today: string) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  return notes.filter((note) => {
    if (!matchesFilters(note, filters, today)) return false
    if (!terms.length) return true
    const text = [note.title, note.body, ...(note.checklist ?? []).map(({ text }) => text)].map((part) => part.toLocaleLowerCase())
    return terms.every((term) => text.some((part) => part.includes(term)))
  })
}
