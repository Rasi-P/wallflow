import { createStore } from 'zustand/vanilla'
import type { InteractionMode, Lighting, NoteColor, NoteDefaults, NoteTaskFields, Point2, StickyNoteData, WallAppearance, WallDocument, WallSection } from '../types/wall.ts'
import { MAX_NOTES, SAMPLE_NOTES, NOTE_HEIGHT, NOTE_WIDTH, NOTE_COLORS, MAX_TITLE_LENGTH, MAX_BODY_LENGTH, MAX_BOARD_NAME_LENGTH } from '../utils/constants.ts'
import { clampNotePosition, getNoteSize, normalizeNoteSize } from '../utils/noteDimensions.ts'
import { changeChecklist, countActiveNotes, hasTaskDetails, isPriority, restoreTaskFields } from '../utils/noteTasks.ts'
import type { ChecklistChange } from '../utils/noteTasks.ts'
import { isDueDate, localDay } from '../utils/taskDates.ts'
import { adjustSectionMembership, clampSectionPosition, getSectionSize, MAX_SECTIONS, MAX_SECTION_NAME, normalizeSectionSize, placeSection, SECTION_HEIGHT, SECTION_WIDTH, sectionAt, withSection } from '../utils/wallSections.ts'
import { DEFAULT_FILTERS, matchesFilters } from '../utils/noteSearch.ts'
import type { WallFilters } from '../utils/noteSearch.ts'
import { isReminderTime, readReminder } from '../utils/reminders.ts'
import type { ReminderPermission } from '../utils/reminders.ts'
import { DEFAULT_APPEARANCE, DEFAULT_NOTE_PREFERENCES, isNoteTypography, NOTE_SIZE_SCALES, readNoteDefaults, readWallAppearance } from '../utils/appearance.ts'
import { removeUnchangedSamples, replaceUntouchedSamplesWithProfessorStudy, TUTORIAL_STEPS } from '../utils/onboarding.ts'
import type { FirstWallOptions, TutorialProgress } from '../utils/onboarding.ts'
import type { Board, BoardId } from '../types/workspace.ts'
import { limitNoteText } from '../utils/noteText.ts'
import { isSketchId } from '../utils/sketches.ts'
import type { SketchId } from '../utils/sketches.ts'

type NotePatch = Partial<Pick<StickyNoteData, 'title' | 'body' | 'position' | 'color' | 'size' | 'rotation'>>
type EditSession = { kind: 'new'; past: WallDocument[]; future: WallDocument[] } | { kind: 'existing'; original: StickyNoteData }
type TaskPatch = Omit<NoteTaskFields, 'checklist'>
type Panel = 'searchOpen' | 'settingsOpen' | 'helpOpen' | 'tasksOpen'
type CameraKind = 'reset' | 'zoom' | 'focus' | 'section' | 'overview'

export interface WallStore extends WallDocument {
  wallName: string
  lighting: Lighting
  appearance: WallAppearance
  noteDefaults: NoteDefaults
  showHints: boolean
  onboardingComplete: boolean
  tutorial: TutorialProgress
  past: WallDocument[]
  future: WallDocument[]
  selectedId: string | null
  selectedSectionId: string | null
  editingId: string | null
  editSession: EditSession | null
  showTaskDetails: boolean
  draggingId: string | null
  draggingFromTouch: boolean
  mode: InteractionMode
  searchOpen: boolean
  settingsOpen: boolean
  helpOpen: boolean
  tasksOpen: boolean
  archiveFocusId: string | null
  filters: WallFilters
  today: string
  reminderPermission: ReminderPermission
  notifiedReminders: string[]
  zoomPercent: number
  zoomBounds: Point2
  cameraCommand: { kind: CameraKind; value?: number; targetId?: string; nonce: number } | null
  select: (id: string | null) => void
  selectSection: (id: string) => void
  setMode: (mode: InteractionMode) => void
  setDragging: (id: string | null, fromTouch?: boolean) => void
  addNote: () => void
  updateNote: (id: string, patch: NotePatch) => void
  deleteNote: (id: string) => void
  editNote: (id: string | null, showTaskDetails?: boolean) => void
  writeNoteText: (id: string, text: Partial<Pick<StickyNoteData, 'title' | 'body' | 'inlineSketches'>>) => void
  setNoteDoodle: (id: string, doodle?: SketchId) => void
  finishEditing: (cancelEmpty?: boolean) => void
  duplicateNote: (id: string) => void
  updateTask: (id: string, patch: TaskPatch) => void
  editChecklist: (id: string, change: ChecklistChange) => void
  setPlanned: (id: string, planned: boolean, itemId?: string) => void
  setReminder: (id: string, at?: number) => void
  setReminderPermission: (permission: ReminderPermission) => void
  markRemindersNotified: (ids: string[]) => void
  archiveNote: (id: string) => void
  restoreNote: (id: string) => void
  permanentlyDeleteNote: (id: string) => void
  createSection: (name: string, position?: Point2, size?: Point2) => string | undefined
  renameSection: (id: string, name: string) => void
  moveSection: (id: string, position: Point2) => void
  resizeSection: (id: string, size: Point2, position?: Point2) => void
  deleteSection: (id: string) => void
  assignSection: (id: string, sectionId?: string) => void
  setFilters: (filters: WallFilters) => void
  focusNote: (id: string) => void
  focusSection: (id: string) => void
  openArchivedNote: (id: string) => void
  chooseColor: (color: NoteColor) => void
  rotateWall: (rotation: Point2) => void
  undo: () => void
  redo: () => void
  setWallName: (name: string) => void
  setAppearance: (patch: Partial<WallAppearance>) => void
  setNoteDefaults: (patch: Partial<NoteDefaults>) => void
  setShowHints: (show: boolean) => void
  completeOnboarding: (options: FirstWallOptions) => void
  startTutorial: () => void
  moveTutorial: (direction: -1 | 1) => void
  exitTutorial: () => void
  setPanel: (panel: Panel, open: boolean) => void
  setToday: (today: string) => void
  setZoomPercent: (percent: number) => void
  setZoomBounds: (bounds: Point2) => void
  commandCamera: (kind: CameraKind, value?: number, targetId?: string) => void
}

const documentOf = ({ notes, sections, wallRotation }: WallDocument): WallDocument => ({ notes, sections, wallRotation })
const checkpoint = (state: WallStore) => ({ past: [...state.past.slice(-49), documentOf(state)], future: [] })
export const clampPosition = clampNotePosition

function replaceNote(notes: StickyNoteData[], next: StickyNoteData) {
  return notes.map((note) => note.id === next.id ? next : note)
}

function matchingSelection(state: WallStore, notes = state.notes, filters = state.filters, today = state.today) {
  const id = state.selectedId
  if (!id || id === state.editingId) return id
  const note = notes.find((entry) => entry.id === id && !entry.archived)
  return note && matchesFilters(note, filters, today) ? id : null
}

function applyTaskChange(state: WallStore, note: StickyNoteData, patch: NoteTaskFields & Pick<StickyNoteData, 'plannedOn' | 'reminder'>) {
  const next = { ...note, ...patch }
  if (JSON.stringify(next) === JSON.stringify(note)) return state
  const notes = replaceNote(state.notes, next)
  return { ...(state.editingId === note.id ? {} : checkpoint(state)), notes, selectedId: matchingSelection(state, notes) }
}

function retainReminderReceipts(value: unknown, notes: StickyNoteData[], history: WallDocument[] = []) {
  if (!Array.isArray(value) || !value.length) return []
  const relevant = new Set<string>()
  for (const group of [notes, ...history.map((snapshot) => snapshot.notes)]) {
    for (const note of group) if (note.reminder) relevant.add(note.reminder.id)
  }
  return [...new Set(value.filter((id): id is string => typeof id === 'string' && relevant.has(id)))]
}

function removeFromHistory(history: WallDocument[], current: WallDocument, id: string) {
  const remaining: WallDocument[] = []
  let previous = current
  for (const snapshot of history) {
    const notes = snapshot.notes.filter((note) => note.id !== id)
    const { sections, wallRotation } = snapshot
    const unchanged = notes.length === previous.notes.length && notes.every((note, index) => note === previous.notes[index]) &&
      sections === previous.sections && wallRotation[0] === previous.wallRotation[0] && wallRotation[1] === previous.wallRotation[1]
    if (unchanged) continue
    previous = { notes, sections, wallRotation }
    remaining.push(previous)
  }
  return remaining
}

const clampRotation = ([tilt, turn]: Point2): Point2 => [
  Math.max(-25, Math.min(25, tilt)),
  Math.max(-30, Math.min(30, turn)),
]

function findNotePosition(notes: StickyNoteData[], size: Point2, rotation: number, footprint: Point2): Point2 {
  const centers = [0, -3.2, 3.2, -6.4, 6.4, -9.6, 9.6, -12.8, 12.8]
  for (const y of [-3.2, 0, 3.2, -6.4, 6.4]) {
    for (const x of centers) {
      const position = clampPosition([x, y], size, rotation)
      if (hasSpace(notes, position, footprint)) return position
    }
  }
  return clampPosition([centers[countActiveNotes(notes) % centers.length], -8], size, rotation)
}

function hasSpace(notes: StickyNoteData[], [x, y]: Point2, [width, height]: Point2 = [NOTE_WIDTH, NOTE_HEIGHT]) {
  return notes.every((note) => {
    if (note.archived) return true
    const [w, h] = getNoteSize(note)
    const c = Math.abs(Math.cos(note.rotation)), s = Math.abs(Math.sin(note.rotation))
    return Math.abs(note.position[0] - x) >= (w * c + h * s + width) / 2 + 0.12 ||
      Math.abs(note.position[1] - y) >= (h * c + w * s + height) / 2 + 0.12
  })
}

function placeNewNote(notes: StickyNoteData[], size: Point2, rotation: number, slots: Point2[]) {
  const [width, height] = size
  const c = Math.abs(Math.cos(rotation)), s = Math.abs(Math.sin(rotation))
  const footprint: Point2 = [width * c + height * s, height * c + width * s]
  const visible = slots.map((position) => clampPosition(position, size, rotation))
  return visible.find((position) => hasSpace(notes, position, footprint)) ?? visible[0] ?? findNotePosition(notes, size, rotation, footprint)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPoint(value: unknown): value is Point2 {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
}

function restoreSections(saved: unknown): WallSection[] {
  if (!Array.isArray(saved)) return []
  const sections: WallSection[] = []
  const ids = new Set<string>()
  for (const section of saved) {
    if (!isRecord(section)) continue
    const { id, name, position } = section
    if (typeof id !== 'string' || !id || ids.has(id) || typeof name !== 'string' || !name.trim() || !isPoint(position)) continue
    const size = isPoint(section.size) ? normalizeSectionSize(section.size) : undefined
    sections.push({ id, name: name.trim().slice(0, MAX_SECTION_NAME), position: clampSectionPosition(position, size), ...(size && { size }) })
    ids.add(id)
    if (sections.length >= MAX_SECTIONS) break
  }
  return sections
}

function restoreNotes(saved: unknown[], sections: WallSection[]): StickyNoteData[] {
  const notes: StickyNoteData[] = []
  const ids = new Set<string>()
  const reminderIds = new Set<string>()
  const sectionIds = new Set(sections.map((section) => section.id))
  let active = 0
  for (const entry of saved) {
    if (!isRecord(entry)) continue
    const { id, title, body, color, position, rotation, doodle } = entry
    if (typeof id !== 'string' || !id || ids.has(id) || typeof title !== 'string' || typeof body !== 'string') continue
    if (typeof color !== 'string' || !Object.hasOwn(NOTE_COLORS, color) || !isPoint(position)) continue
    if (typeof rotation !== 'number' || !Number.isFinite(rotation)) continue

    const note: StickyNoteData = {
      id, title: limitNoteText(title, MAX_TITLE_LENGTH), body: limitNoteText(body, MAX_BODY_LENGTH),
      color: color as NoteColor, position, rotation,
    }
    if (isPoint(entry.size) && entry.size.every((dimension) => dimension > 0)) note.size = normalizeNoteSize(entry.size)
    if (isNoteTypography(entry.typography)) note.typography = entry.typography
    note.position = clampPosition(position, note.size, rotation)
    if (doodle === 'spark' || doodle === 'flower' || doodle === 'leaf' || isSketchId(doodle)) note.doodle = doodle
    if (entry.inlineSketches === true) note.inlineSketches = true
    restoreTaskFields(note, entry)
    if (typeof entry.sectionId === 'string' && sectionIds.has(entry.sectionId)) note.sectionId = entry.sectionId
    if (!note.archived && active >= MAX_NOTES) continue
    if (isDueDate(entry.plannedOn)) note.plannedOn = entry.plannedOn
    const reminder = readReminder(entry.reminder)
    if (reminder && !reminderIds.has(reminder.id)) {
      note.reminder = reminder
      reminderIds.add(reminder.id)
    }
    notes.push(note)
    ids.add(id)
    if (!note.archived) active++
  }
  return notes
}

export function restoreWall(saved: unknown, current: WallStore): WallStore {
  if (!isRecord(saved)) return current
  const sections = restoreSections(saved.sections)
  let notes = current.notes
  if (Array.isArray(saved.notes)) {
    const restored = restoreNotes(saved.notes, sections)
    if (restored.length > 0 || saved.notes.length === 0) notes = restored
  }
  return {
    ...current,
    notes,
    sections,
    appearance: readWallAppearance(saved.appearance),
    noteDefaults: readNoteDefaults(saved.noteDefaults),
    notifiedReminders: retainReminderReceipts(saved.notifiedReminders, notes),
    filters: filtersForSections(current.filters, sections),
    wallRotation: isPoint(saved.wallRotation) ? clampRotation(saved.wallRotation) : current.wallRotation,
    wallName: (typeof saved.wallName === 'string' && saved.wallName.trim().slice(0, MAX_BOARD_NAME_LENGTH)) || current.wallName,
    lighting: saved.lighting === 'warm' || saved.lighting === 'daylight' ? saved.lighting : current.lighting,
    showHints: typeof saved.showHints === 'boolean' ? saved.showHints : current.showHints,
    // A saved wall without this flag predates onboarding, even if its welcome was never dismissed.
    onboardingComplete: saved.onboardingComplete !== false,
  }
}

function filtersForSections(filters: WallFilters, sections: WallSection[]): WallFilters {
  return filters.section && !sections.some((section) => section.id === filters.section)
    ? { ...filters, section: null }
    : filters
}

export function createBoardStore({ board, blank = false, visibleSlots = () => [] }: {
  board?: Board
  blank?: boolean
  visibleSlots?: () => Point2[]
} = {}) {
  const store = createStore<WallStore>((set, get) => ({
    notes: blank ? [] : structuredClone(SAMPLE_NOTES), sections: [], wallRotation: [0, 0], wallName: 'My everyday wall', lighting: 'daylight', showHints: true,
    onboardingComplete: blank, tutorial: null,
    appearance: { ...DEFAULT_APPEARANCE }, noteDefaults: { ...DEFAULT_NOTE_PREFERENCES },
    past: [], future: [], selectedId: null, selectedSectionId: null, editingId: null, editSession: null, showTaskDetails: false, draggingId: null, draggingFromTouch: false,
    mode: 'select', searchOpen: false, settingsOpen: false, helpOpen: false, tasksOpen: false, today: localDay(),
    archiveFocusId: null, filters: DEFAULT_FILTERS,
    reminderPermission: 'unavailable', notifiedReminders: [],
    zoomPercent: 100, zoomBounds: [32, 292], cameraCommand: null,
    select: (id) => set((state) => {
      const note = state.notes.find((entry) => entry.id === id && !entry.archived)
      return { selectedId: note?.id ?? null, selectedSectionId: null }
    }),
    selectSection: (id) => set((state) => state.sections.some((section) => section.id === id)
      ? { selectedId: null, selectedSectionId: id } : state),
    setMode: (mode) => { get().finishEditing(); set({ mode, selectedId: null, selectedSectionId: null }) },
    setDragging: (draggingId, fromTouch = false) => set({ draggingId, draggingFromTouch: draggingId !== null && fromTouch }),
    addNote: () => {
      const state = get()
      const count = countActiveNotes(state.notes)
      if (count >= MAX_NOTES || state.editingId || state.draggingId) return
      const { noteDefaults } = state
      const scale = NOTE_SIZE_SCALES[noteDefaults.size]
      const size: Point2 = [NOTE_WIDTH * scale, NOTE_HEIGHT * scale]
      const rotation = noteDefaults.rotation === 'straight' ? 0 : (Math.random() - 0.5) * 0.108
      const note: StickyNoteData = {
        id: crypto.randomUUID(), title: '', body: '', color: noteDefaults.color,
        position: placeNewNote(state.notes, size, rotation, visibleSlots()), rotation,
      }
      if (noteDefaults.size !== 'standard') note.size = size
      if (noteDefaults.typography !== 'handwritten') note.typography = noteDefaults.typography
      const placed = withSection(note, sectionAt(state.sections, note.position))
      const filters = matchesFilters(placed, state.filters, state.today) ? state.filters : DEFAULT_FILTERS
      set({ ...checkpoint(state), notes: [...state.notes, placed], selectedId: note.id, selectedSectionId: null, editingId: note.id, filters,
        editSession: { kind: 'new', past: state.past, future: state.future }, showTaskDetails: false, mode: 'select' })
    },
    updateNote: (id, patch) => {
      get().finishEditing()
      set((state) => {
        const old = state.notes.find((note) => note.id === id)
        if (!old || old.archived) return state
        let next = { ...old, ...patch }
        if (patch.size) next.size = normalizeNoteSize(patch.size)
        if (patch.position || patch.size || patch.rotation !== undefined) next.position = clampPosition(next.position, next.size, next.rotation)
        if (patch.position && (next.position[0] !== old.position[0] || next.position[1] !== old.position[1])) {
          next = withSection(next, sectionAt(state.sections, next.position, old.sectionId))
        }
        if (JSON.stringify(old) === JSON.stringify(next)) return state
        const notes = replaceNote(state.notes, next)
        return { ...checkpoint(state), notes, selectedId: matchingSelection(state, notes) }
      })
    },
    deleteNote: (id) => {
      get().finishEditing()
      set((state) => {
        const notes = state.notes.filter((note) => note.id !== id || note.archived)
        if (notes.length === state.notes.length) return state
        return { ...checkpoint(state), notes, selectedId: null }
      })
    },
    editNote: (id, showTaskDetails = false) => {
      const state = get()
      if (id === state.editingId || state.draggingId) return
      state.finishEditing()
      if (!id) return
      const note = get().notes.find((entry) => entry.id === id)
      if (note && !note.archived) set({ editingId: id, selectedId: id, mode: 'select', showTaskDetails, editSession: { kind: 'existing', original: note } })
    },
    writeNoteText: (id, text) => {
      if (get().editingId !== id) return
      set((state) => ({ notes: state.notes.map((note) => note.id !== id ? note : {
        ...note,
        title: text.title === undefined ? note.title : limitNoteText(text.title, MAX_TITLE_LENGTH),
        body: text.body === undefined ? note.body : limitNoteText(text.body, MAX_BODY_LENGTH),
        ...(text.inlineSketches === true ? { inlineSketches: true as const } : {}),
      }) }))
    },
    setNoteDoodle: (id, doodle) => {
      if (get().editingId !== id || (doodle !== undefined && !isSketchId(doodle))) return
      set((state) => {
        const note = state.notes.find((entry) => entry.id === id)
        if (!note || note.doodle === doodle) return state
        const next = { ...note }
        if (doodle) next.doodle = doodle
        else delete next.doodle
        return { notes: replaceNote(state.notes, next) }
      })
    },
    finishEditing: (cancelEmpty = false) => {
      const state = get()
      const { editingId, editSession } = state
      if (!editingId) return
      const note = state.notes.find((entry) => entry.id === editingId)
      const selectedId = note?.id === state.selectedId && !matchesFilters(note, state.filters, state.today) ? null : state.selectedId
      const end = { editingId: null, editSession: null, showTaskDetails: false, selectedId }
      if (note && editSession?.kind === 'new' && cancelEmpty && !note.title.trim() && !note.body.trim() && !hasTaskDetails(note) && !note.reminder && !note.plannedOn && !note.doodle) {
        set({ ...end, notes: state.notes.filter((entry) => entry.id !== editingId), selectedId: null, past: editSession.past, future: editSession.future })
        return
      }
      if (note && editSession?.kind === 'existing' && JSON.stringify(editSession.original) !== JSON.stringify(note)) {
        const before = replaceNote(state.notes, editSession.original)
        set({ ...end, past: [...state.past.slice(-49), { ...documentOf(state), notes: before }], future: [] })
        return
      }
      set(end)
    },
    duplicateNote: (id) => {
      get().finishEditing()
      set((state) => {
        const source = state.notes.find((note) => note.id === id)
        if (!source || source.archived || countActiveNotes(state.notes) >= MAX_NOTES || state.draggingId) return state
        const [x, y] = source.position
        const size = getNoteSize(source)
        const candidates: Point2[] = [[x + size[0] + 0.38, y - 0.25], [x - size[0] - 0.38, y - 0.25], [x, y - size[1] - 0.38], [x, y + size[1] + 0.38]]
        const position = candidates.map((point) => clampPosition(point, size, source.rotation)).find((point) => hasSpace(state.notes, point, size))
          ?? clampPosition([x + 0.34, y - 0.34], size, source.rotation)
        const copy = { ...source, id: crypto.randomUUID(), position }
        delete copy.reminder
        delete copy.plannedOn
        if (source.checklist) copy.checklist = source.checklist.map(({ text, done }) => ({ id: crypto.randomUUID(), text, done }))
        const placed = withSection(copy, sectionAt(state.sections, position, source.sectionId) ?? source.sectionId)
        const filters = matchesFilters(placed, state.filters, state.today) ? state.filters : DEFAULT_FILTERS
        return { ...checkpoint(state), notes: [...state.notes, placed], selectedId: copy.id, mode: 'select', filters }
      })
    },
    updateTask: (id, patch) => {
      if (get().editingId !== id) get().finishEditing()
      set((state) => {
        const note = state.notes.find((item) => item.id === id && !item.archived)
        if (!note) return state
        const changes: NoteTaskFields = {}
        if ('priority' in patch && (patch.priority === undefined || isPriority(patch.priority))) changes.priority = patch.priority
        if ('dueDate' in patch && (patch.dueDate === undefined || isDueDate(patch.dueDate))) changes.dueDate = patch.dueDate
        if ('completed' in patch) changes.completed = patch.completed === true ? true : undefined
        return applyTaskChange(state, note, changes)
      })
    },
    editChecklist: (id, change) => {
      if (get().editingId !== id) get().finishEditing()
      set((state) => {
        const note = state.notes.find((item) => item.id === id && !item.archived)
        if (!note) return state
        const previous = note.checklist ?? []
        const checklist = changeChecklist(previous, change)
        if (previous === checklist) return state
        return applyTaskChange(state, note, { checklist: checklist.length ? checklist : undefined })
      })
    },
    setPlanned: (id, planned, itemId) => {
      if (get().editingId !== id) get().finishEditing()
      set((state) => {
        const note = state.notes.find((item) => item.id === id && !item.archived)
        if (!note) return state
        const plannedOn = planned ? state.today : undefined
        if (itemId === undefined) {
          if ((note.plannedOn === state.today) === planned) return state
          return applyTaskChange(state, note, { plannedOn })
        }
        const item = note.checklist?.find((entry) => entry.id === itemId)
        if (!item || (item.plannedOn === state.today) === planned) return state
        const checklist = note.checklist!.map((entry) => entry === item ? { ...entry, plannedOn } : entry)
        return applyTaskChange(state, note, { checklist })
      })
    },
    setReminder: (id, at) => {
      if (at !== undefined && !isReminderTime(at)) return
      if (get().editingId !== id) get().finishEditing()
      set((state) => {
        const note = state.notes.find((item) => item.id === id && !item.archived)
        if (!note || note.reminder?.at === at) return state
        return applyTaskChange(state, note, { reminder: at === undefined ? undefined : { id: crypto.randomUUID(), at } })
      })
    },
    setReminderPermission: (permission) => {
      if (get().reminderPermission !== permission) set({ reminderPermission: permission })
    },
    markRemindersNotified: (ids) => set((state) => {
      const notifiedReminders = retainReminderReceipts([...state.notifiedReminders, ...ids], state.notes, [...state.past, ...state.future])
      if (notifiedReminders.length === state.notifiedReminders.length &&
        notifiedReminders.every((id, index) => id === state.notifiedReminders[index])) return state
      return { notifiedReminders }
    }),
    archiveNote: (id) => {
      get().finishEditing()
      set((state) => {
        const note = state.notes.find((entry) => entry.id === id && !entry.archived)
        if (!note || state.draggingId) return state
        return { ...checkpoint(state), notes: replaceNote(state.notes, { ...note, archived: true }), selectedId: state.selectedId === id ? null : state.selectedId }
      })
    },
    restoreNote: (id) => {
      get().finishEditing()
      set((state) => {
        const note = state.notes.find((entry) => entry.id === id && entry.archived)
        if (!note || countActiveNotes(state.notes) >= MAX_NOTES || state.draggingId) return state
        const restored = { ...note }
        delete restored.archived
        return { ...checkpoint(state), notes: replaceNote(state.notes, restored) }
      })
    },
    permanentlyDeleteNote: (id) => {
      get().finishEditing()
      set((state) => {
        if (!state.notes.some((note) => note.id === id && note.archived)) return state
        const notes = state.notes.filter((note) => note.id !== id)
        const current = { ...documentOf(state), notes }
        const past = removeFromHistory([...state.past].reverse(), current, id).reverse()
        const future = removeFromHistory(state.future, current, id)
        return {
          notes, past, future,
          notifiedReminders: retainReminderReceipts(state.notifiedReminders, notes, [...past, ...future]),
        }
      })
    },
    createSection: (name, position, size) => {
      const nextName = name.trim().slice(0, MAX_SECTION_NAME)
      const state = get()
      if (!nextName || state.sections.length >= MAX_SECTIONS || state.draggingId) return
      state.finishEditing()
      const area = isPoint(size) ? normalizeSectionSize(size) : undefined
      const section: WallSection = {
        id: crypto.randomUUID(), name: nextName,
        position: isPoint(position) ? clampSectionPosition(position, area) : placeSection(state.sections, visibleSlots(), area),
        ...(area && (area[0] !== SECTION_WIDTH || area[1] !== SECTION_HEIGHT) && { size: area }),
      }
      set((current) => {
        const sections = [...current.sections, section]
        const notes = adjustSectionMembership(current.notes, sections, section)
        return { ...checkpoint(current), sections, notes, selectedId: matchingSelection(current, notes) }
      })
      return section.id
    },
    renameSection: (id, name) => {
      const nextName = name.trim().slice(0, MAX_SECTION_NAME)
      if (!nextName || get().draggingId) return
      get().finishEditing()
      set((state) => {
        const section = state.sections.find((entry) => entry.id === id)
        if (!section || section.name === nextName) return state
        return { ...checkpoint(state), sections: state.sections.map((entry) => entry === section ? { ...entry, name: nextName } : entry) }
      })
    },
    moveSection: (id, position) => {
      if (!isPoint(position)) return
      get().finishEditing()
      set((state) => {
        if (state.draggingId && state.draggingId !== id) return state
        const before = state.sections.find((entry) => entry.id === id)
        if (!before) return state
        const nextPosition = clampSectionPosition(position, getSectionSize(before))
        if (before.position[0] === nextPosition[0] && before.position[1] === nextPosition[1]) return state
        const next = { ...before, position: nextPosition }
        const sections = state.sections.map((entry) => entry === before ? next : entry)
        const notes = adjustSectionMembership(state.notes, sections, next, before)
        return { ...checkpoint(state), sections, notes, selectedId: matchingSelection(state, notes) }
      })
    },
    resizeSection: (id, size, position) => {
      if (!isPoint(size)) return
      get().finishEditing()
      set((state) => {
        if (state.draggingId && state.draggingId !== id) return state
        const before = state.sections.find((entry) => entry.id === id)
        if (!before) return state
        const bounded = normalizeSectionSize(size)
        const nextPosition = clampSectionPosition(isPoint(position) ? position : before.position, bounded)
        const [width, height] = getSectionSize(before)
        if (width === bounded[0] && height === bounded[1] &&
          before.position[0] === nextPosition[0] && before.position[1] === nextPosition[1]) return state
        const next = { ...before, position: nextPosition, size: bounded }
        const sections = state.sections.map((entry) => entry === before ? next : entry)
        const notes = adjustSectionMembership(state.notes, sections, next, before)
        return { ...checkpoint(state), sections, notes, selectedId: matchingSelection(state, notes) }
      })
    },
    deleteSection: (id) => {
      if (get().draggingId) return
      get().finishEditing()
      set((state) => {
        const sections = state.sections.filter((section) => section.id !== id)
        if (sections.length === state.sections.length) return state
        const notes = state.notes.map((note) => note.sectionId === id ? withSection(note) : note)
        const filters = filtersForSections(state.filters, sections)
        return { ...checkpoint(state), sections, notes, filters, selectedId: matchingSelection(state, notes, filters),
          selectedSectionId: state.selectedSectionId === id ? null : state.selectedSectionId }
      })
    },
    assignSection: (id, sectionId) => {
      if (get().draggingId) return
      get().finishEditing()
      set((state) => {
        const note = state.notes.find((entry) => entry.id === id && !entry.archived)
        if (!note || (sectionId && !state.sections.some((section) => section.id === sectionId))) return state
        const next = withSection(note, sectionId || undefined)
        if (note === next) return state
        const notes = replaceNote(state.notes, next)
        return { ...checkpoint(state), notes, selectedId: matchingSelection(state, notes) }
      })
    },
    setFilters: (filters) => set((state) => ({ filters, selectedId: matchingSelection(state, state.notes, filters) })),
    focusNote: (id) => {
      const state = get()
      const note = state.notes.find((entry) => entry.id === id && !entry.archived)
      if (!note || state.draggingId) return
      if (!matchesFilters(note, state.filters, state.today)) state.setFilters(DEFAULT_FILTERS)
      state.select(id)
      state.commandCamera('focus', undefined, id)
    },
    focusSection: (id) => {
      const state = get()
      if (state.draggingId || !state.sections.some((section) => section.id === id)) return
      state.selectSection(id)
      state.commandCamera('section', undefined, id)
    },
    openArchivedNote: (id) => {
      const state = get()
      if (!state.notes.some((note) => note.id === id && note.archived)) return
      state.setPanel('tasksOpen', true)
      set({ archiveFocusId: id })
    },
    chooseColor: (color) => {
      if (!Object.hasOwn(NOTE_COLORS, color)) return
      const state = get()
      if (state.selectedId) state.updateNote(state.selectedId, { color })
      else state.setNoteDefaults({ color })
    },
    rotateWall: (wallRotation) => set((state) => {
      const bounded = clampRotation(wallRotation)
      if (state.wallRotation[0] === bounded[0] && state.wallRotation[1] === bounded[1]) return state
      return { ...checkpoint(state), wallRotation: bounded }
    }),
    undo: () => set((state) => {
      if (state.draggingId || state.editingId) return state
      const previous = state.past.at(-1)
      if (!previous) return state
      return { ...previous, filters: filtersForSections(state.filters, previous.sections), past: state.past.slice(0, -1), future: [documentOf(state), ...state.future], selectedId: null, selectedSectionId: null, editingId: null, draggingId: null }
    }),
    redo: () => set((state) => {
      if (state.draggingId || state.editingId) return state
      const next = state.future[0]
      if (!next) return state
      return { ...next, filters: filtersForSections(state.filters, next.sections), past: [...state.past, documentOf(state)], future: state.future.slice(1), selectedId: null, selectedSectionId: null, editingId: null, draggingId: null }
    }),
    setWallName: (wallName) => set({ wallName: wallName.trim().slice(0, MAX_BOARD_NAME_LENGTH) || 'My everyday wall' }),
    setAppearance: (patch) => set((state) => ({ appearance: readWallAppearance({ ...state.appearance, ...patch }) })),
    setNoteDefaults: (patch) => set((state) => ({ noteDefaults: readNoteDefaults({ ...state.noteDefaults, ...patch }) })),
    setShowHints: (showHints) => set({ showHints }),
    completeOnboarding: ({ starter, theme, color, sampleSet, offerTutorial = true }) => {
      const state = get()
      if (state.onboardingComplete || state.draggingId) return
      state.finishEditing()
      set((current) => {
        const notes = starter === 'blank' ? removeUnchangedSamples(current.notes)
          : sampleSet === 'professors-study' ? replaceUntouchedSamplesWithProfessorStudy(current.notes) : current.notes
        const changedSamples = notes !== current.notes && (starter !== 'blank' || notes.length < current.notes.length)
        return {
          ...(changedSamples ? { ...checkpoint(current), notes, selectedId: matchingSelection(current, notes) } : {}),
          appearance: theme === undefined ? current.appearance : readWallAppearance({ ...current.appearance, theme }),
          noteDefaults: color === undefined ? current.noteDefaults : readNoteDefaults({ ...current.noteDefaults, color }),
          onboardingComplete: true,
          tutorial: offerTutorial ? 'invite' : null,
        }
      })
    },
    startTutorial: () => {
      const state = get()
      if (state.draggingId) return
      if (!state.onboardingComplete) state.completeOnboarding({ starter: 'samples', offerTutorial: false })
      set({ tutorial: 0, helpOpen: false, settingsOpen: false })
    },
    moveTutorial: (direction) => set((state) => {
      if (typeof state.tutorial !== 'number') return state
      const next = Math.max(0, state.tutorial + direction)
      return { tutorial: next < TUTORIAL_STEPS.length ? next : null }
    }),
    exitTutorial: () => set({ tutorial: null }),
    setPanel: (panel, open) => {
      if (open) get().finishEditing()
      if (open) set({ searchOpen: false, settingsOpen: false, helpOpen: false, tasksOpen: false, archiveFocusId: null, [panel]: true })
      else set({ [panel]: false })
    },
    setToday: (today) => {
      const state = get()
      if (today !== state.today) set({ today, selectedId: matchingSelection(state, state.notes, state.filters, today) })
    },
    setZoomPercent: (zoomPercent) => set({ zoomPercent }),
    setZoomBounds: (zoomBounds) => set({ zoomBounds }),
    commandCamera: (kind, value, targetId) => set((state) => ({ cameraCommand: { kind, value, targetId, nonce: (state.cameraCommand?.nonce ?? 0) + 1 } })),
  }))
  if (board) {
    store.setState({
      ...structuredClone({
        ...board.document,
        ...board.presentation,
        ...board.preferences,
        notifiedReminders: board.notifiedReminders,
      }),
      wallName: board.name,
    })
  }
  return store
}

export function snapshotBoard(id: BoardId, state: WallStore): Board {
  return {
    id,
    name: state.wallName,
    document: documentOf(state),
    preferences: { noteDefaults: state.noteDefaults, showHints: state.showHints, onboardingComplete: state.onboardingComplete },
    presentation: { lighting: state.lighting, appearance: state.appearance },
    notifiedReminders: state.notifiedReminders,
  }
}
