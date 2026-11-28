import { Archive, Check, ChevronDown, CloudCheck, CloudOff, LayoutGrid, ListTodo, Plus, Search, Settings2, SlidersHorizontal, StickyNote, Trash2, Undo2, X, Zap } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Account } from '../../types/auth'
import { useWallStore, useWorkspaceStore, workspace } from '../../stores/wallStore'
import { useLinkedBoard } from '../../stores/linkedBoard'
import type { LinkedStatus } from '../../stores/linkedBoard'
import { MAX_BODY_LENGTH, MAX_NOTES, MAX_TITLE_LENGTH, NOTE_COLORS } from '../../utils/constants'
import type { StickyNoteData } from '../../types/wall'
import { countActiveNotes, getChecklistProgress, PRIORITY_LABELS } from '../../utils/noteTasks'
import { DEFAULT_FILTERS, hasWallFilters, searchNotes } from '../../utils/noteSearch'
import type { WallFilters } from '../../utils/noteSearch'
import { formatDueDate } from '../../utils/taskDates'
import { NoteTaskDetails } from '../sticky-note/NoteTaskDetails'
import { BoardManagementDialog } from '../ui/BoardManagementDialog'
import { Modal } from '../ui/Modal'
import { SettingsDialog } from '../ui/SettingsDialog'
import { TasksPanel } from '../ui/TasksPanel'

const syncLabels: Record<LinkedStatus, string> = {
  checking: 'Connecting', saved: 'Synced', saving: 'Syncing', unsaved: 'Retry sync',
  unavailable: 'Reconnect', offline: 'Offline', conflict: 'Resolve conflict',
}

function MobileNoteEditor({ note }: { note: StickyNoteData }) {
  const actions = useWallStore.getState()
  const close = () => actions.finishEditing(true)
  return <Modal title="Edit note" className="mobile-note-editor" onClose={close}>
    <div className="mobile-editor-content">
      <label className="mobile-field">Title
        <input data-initial-focus placeholder="Title" maxLength={MAX_TITLE_LENGTH} value={note.title}
          onChange={(event) => actions.writeNoteText(note.id, { title: event.target.value })} />
      </label>
      <label className="mobile-field">Note
        <textarea rows={4} placeholder="Write a note…" maxLength={MAX_BODY_LENGTH} value={note.body}
          onChange={(event) => actions.writeNoteText(note.id, { body: event.target.value })} />
      </label>
      <NoteTaskDetails note={note} />
      <div className="mobile-editor-actions">
        <button type="button" className="text-button" onClick={() => { close(); actions.archiveNote(note.id) }}><Archive size={17} /> Archive</button>
        <button type="button" className="text-button mobile-delete" onClick={() => {
          if (window.confirm('Delete this note? You can undo this on the board.')) { close(); actions.deleteNote(note.id) }
        }}><Trash2 size={17} /> Delete</button>
        <button type="button" className="primary-button" onClick={close}><Check size={17} /> Done</button>
      </div>
    </div>
  </Modal>
}

export function MobileWorkspace({ account, onSignIn, onSignOut, onCapture }: {
  account?: Account; onSignIn?: () => void; onSignOut?: () => void; onCapture: () => void
}) {
  const [query, setQuery] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [manage, setManage] = useState(false)
  const [online, setOnline] = useState(() => navigator.onLine)
  const status = useLinkedBoard((state) => state.status)
  const queued = useLinkedBoard((state) => state.capture?.entries.length ?? 0)
  const boards = useWorkspaceStore((state) => state.boards)
  const boardOrder = useWorkspaceStore((state) => state.boardOrder)
  const active = useWorkspaceStore((state) => state.activeBoardId)
  const notes = useWallStore((state) => state.notes)
  const sections = useWallStore((state) => state.sections)
  const filters = useWallStore((state) => state.filters)
  const today = useWallStore((state) => state.today)
  const canUndo = useWallStore((state) => state.past.length > 0)
  const tasks = useWallStore((state) => state.tasksOpen)
  const settings = useWallStore((state) => state.settingsOpen)
  const editId = useWallStore((state) => state.editingId)
  const editing = notes.find((note) => note.id === editId)
  const activeCount = countActiveNotes(notes)
  const results = useMemo(() => searchNotes(notes, query, filters, today).reverse(), [notes, query, filters, today])
  const actions = useWallStore.getState()
  const changeFilter = <K extends keyof WallFilters>(key: K, value: WallFilters[K]) => actions.setFilters({ ...filters, [key]: value })

  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  return <main className="mobile-workspace">
    <header className="mobile-topbar">
      <div className="mobile-brand"><img src="/favicon.svg" alt="" width="31" height="31" /> WALLFLOW</div>
      <button type="button" className="mobile-sync" onClick={() => setManage(true)}>
        {online && status !== 'offline' ? <CloudCheck size={17} /> : <CloudOff size={17} />}
        {online ? account ? syncLabels[status] : 'This device' : 'Offline'}
      </button>
    </header>

    <div className="mobile-scroll">
      <section className="mobile-board-heading" aria-label="Current board">
        <div className="mobile-board-picker">
          <LayoutGrid size={15} /><span>Switch board</span><select aria-label="Switch board" value={active} onChange={(event) => {
            if (workspace.switchBoard(event.target.value)) setQuery('')
          }}>
            {boardOrder.map((id) => <option key={id} value={id}>{boards[id].name}</option>)}
          </select><ChevronDown size={14} />
        </div>
        <h1>{boards[active]?.name ?? 'Board'}</h1>
        <div className="mobile-board-actions">
          <span>{activeCount} of {MAX_NOTES} active notes</span>
          <button type="button" className="mobile-icon" aria-label="Undo last board change" disabled={!canUndo} onClick={actions.undo}><Undo2 size={18} /></button>
          <button type="button" className="mobile-new-note" disabled={activeCount >= MAX_NOTES} onClick={actions.addNote}><Plus size={17} /> New note</button>
        </div>
      </section>

      <div className="mobile-search-row">
        <label className="mobile-search"><Search size={18} /><input type="search" aria-label="Search notes" placeholder="Search this board"
          value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button type="button" className="mobile-icon mobile-filter-trigger" aria-label="Filter notes" aria-expanded={showFilters}
          data-filtered={hasWallFilters(filters)} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal size={18} /></button>
      </div>
      {showFilters && <section className="mobile-filters" aria-label="Note filters">
        <label className="mobile-field">Status<select value={filters.completion} onChange={(e) => changeFilter('completion', e.target.value as WallFilters['completion'])}>
          <option value="any">Any status</option><option value="open">Open</option><option value="completed">Completed</option>
        </select></label>
        <label className="mobile-field">Priority<select value={filters.priority} onChange={(e) => changeFilter('priority', e.target.value as WallFilters['priority'])}>
          <option value="any">Any priority</option><option value="none">No priority</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <label className="mobile-field">Due date<select value={filters.due} onChange={(e) => changeFilter('due', e.target.value as WallFilters['due'])}>
          <option value="any">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option>
          <option value="upcoming">Upcoming</option><option value="none">No date</option>
        </select></label>
        <label className="mobile-field">Section<select value={filters.section ?? 'all'} onChange={(e) => changeFilter('section', e.target.value === 'all' ? null : e.target.value)}>
          <option value="all">All sections</option><option value="">Unassigned</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
        </select></label>
        <label className="mobile-field">Archive<select value={filters.archive} onChange={(e) => changeFilter('archive', e.target.value as WallFilters['archive'])}>
          <option value="active">On the board</option><option value="archived">Archived</option><option value="all">All notes</option>
        </select></label>
        <button type="button" className="text-button" onClick={() => actions.setFilters(DEFAULT_FILTERS)}><X size={15} /> Clear filters</button>
      </section>}
      {results.length ? <ul className="mobile-note-grid" aria-label="Notes">
        {results.map((note) => {
          const color = NOTE_COLORS[note.color]
          const progress = note.checklist?.length ? getChecklistProgress(note.checklist) : undefined
          const title = note.title || (!note.body && !progress ? 'Untitled note' : '')
          return <li key={note.id} className="mobile-note" style={{ backgroundColor: color.paper, color: color.ink }}>
            <button type="button" aria-label={`${note.archived ? 'Open archived' : 'Edit'} ${title || note.body || 'checklist note'}`} onClick={() => note.archived ? actions.openArchivedNote(note.id) : actions.editNote(note.id)}>
              <span className="mobile-note-mark">{note.archived ? <Archive size={16} /> : note.completed ? <Check size={16} /> : <StickyNote size={16} />}</span>
              {title && <strong>{title}</strong>}
              {note.body && <span className="mobile-note-body">{note.body}</span>}
              {!note.body && progress && <span className="mobile-note-body">{note.checklist?.[0].text}</span>}
              {(progress || note.dueDate || note.priority) && <span className="mobile-note-meta">
                {progress && <span><ListTodo size={14} /> {progress}</span>}
                {note.priority && <span>{PRIORITY_LABELS[note.priority]}</span>}
                {note.dueDate && <span>{formatDueDate(note.dueDate, today)}</span>}
              </span>}
            </button>
          </li>
        })}
      </ul> : <div className="mobile-empty">
        <StickyNote size={30} />
        <h2>{query || hasWallFilters(filters) ? 'No matching notes' : 'This board is empty'}</h2>
        {!(query || hasWallFilters(filters)) && <button type="button" className="text-button" onClick={actions.addNote}>Add your first note</button>}
      </div>}
    </div>

    <nav className="mobile-nav" aria-label="Workspace">
      <button type="button" onClick={() => setManage(true)}><LayoutGrid size={20} /> Boards</button>
      <button type="button" id="wall-task-panel-trigger" aria-expanded={tasks}
        onClick={() => actions.setPanel('tasksOpen', !tasks)}><ListTodo size={21} /> Tasks</button>
      <button type="button" className="mobile-capture-nav" onClick={onCapture}>
        <span><Zap size={20} />{queued > 0 && <b aria-label={`${queued} pending captures`}>{queued}</b>}</span> Capture
      </button>
      <button type="button" aria-expanded={settings} onClick={() => actions.setPanel('settingsOpen', true)}><Settings2 size={20} /> Settings</button>
    </nav>
    {tasks && <TasksPanel onOpenNote={(id) => actions.editNote(id, true)} />}
    {editing && <MobileNoteEditor key={editing.id} note={editing} />}
    {settings && <SettingsDialog mobile account={account} onSignIn={onSignIn} onSignOut={onSignOut} />}
    {manage && <BoardManagementDialog boardId={active} boardName={boards[active]?.name ?? ''}
      canDelete={boardOrder.length > 1} onClose={() => setManage(false)} />}
  </main>
}
