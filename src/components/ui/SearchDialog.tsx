import { useMemo, useState } from 'react'
import { Archive, Search, StickyNote } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { NOTE_COLORS } from '../../utils/constants'
import { PRIORITY_LABELS } from '../../utils/noteTasks'
import { DEFAULT_FILTERS, hasWallFilters, searchNotes } from '../../utils/noteSearch'
import type { WallFilters } from '../../utils/noteSearch'
import { Modal } from './Modal'
import { SectionDirectory } from './SectionDirectory'

export function SearchDialog() {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'notes' | 'sections'>('notes')
  const notes = useWallStore((state) => state.notes)
  const sections = useWallStore((state) => state.sections)
  const filters = useWallStore((state) => state.filters)
  const today = useWallStore((state) => state.filters.due === 'any' ? '' : state.today)
  const results = useMemo(() => searchNotes(notes, query, filters, today), [notes, query, filters, today])
  const names = useMemo(() => new Map(sections.map(({ id, name }) => [id, name])), [sections])
  const actions = useWallStore.getState()
  const close = () => actions.setPanel('searchOpen', false)
  const changeFilter = <K extends keyof WallFilters>(key: K, value: WallFilters[K]) => actions.setFilters({ ...filters, [key]: value })
  const normalizedQuery = query.trim().toLocaleLowerCase()

  return <Modal title="Find on your wall" onClose={close} className="search-modal">
    <div className="task-panel-views search-views" role="group" aria-label="Wall views">
      <button type="button" aria-pressed={view === 'notes'} onClick={() => setView('notes')}>Notes</button>
      <button type="button" aria-pressed={view === 'sections'} onClick={() => setView('sections')}>Sections</button>
    </div>
    {view === 'notes' ? <>
      <label className="search-field"><Search size={19} /><input type="search" aria-label="Search your notes" data-initial-focus value={query}
        onChange={(event) => setQuery(event.target.value)} placeholder="Search titles, descriptions, or checklists" /></label>
      <div className="search-filters" role="group" aria-label="Filter notes">
        <label>Priority<select value={filters.priority} onChange={(e) => changeFilter('priority', e.target.value as WallFilters['priority'])}>
          <option value="any">Any priority</option><option value="none">No priority</option>
          {Object.entries(PRIORITY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select></label>
        <label>Completion<select value={filters.completion} onChange={(e) => changeFilter('completion', e.target.value as WallFilters['completion'])}>
          <option value="any">Any status</option><option value="open">Open</option><option value="completed">Completed</option>
        </select></label>
        <label>Due date<select value={filters.due} onChange={(e) => changeFilter('due', e.target.value as WallFilters['due'])}>
          <option value="any">Any date</option><option value="overdue">Overdue</option><option value="today">Today</option><option value="upcoming">Upcoming</option><option value="none">No date</option>
        </select></label>
        <label>Section<select value={filters.section === null ? 'any' : `section:${filters.section}`}
          onChange={(e) => changeFilter('section', e.target.value === 'any' ? null : e.target.value.slice('section:'.length))}>
          <option value="any">All sections</option><option value="section:">Unassigned</option>
          {sections.map((section) => <option key={section.id} value={`section:${section.id}`}>{section.name}</option>)}
        </select></label>
        <label>Archive<select value={filters.archive} onChange={(e) => changeFilter('archive', e.target.value as WallFilters['archive'])}>
          <option value="active">On the wall</option><option value="archived">Archived</option><option value="all">All notes</option>
        </select></label>
        <button type="button" className="text-button clear-search-filters" disabled={!hasWallFilters(filters)} onClick={() => actions.setFilters(DEFAULT_FILTERS)}>Clear filters</button>
      </div>
      <p className="result-count" role="status">{results.length} {results.length === 1 ? 'matching note' : 'matching notes'}</p>
      <div className="search-results">
        {results.map((note) => {
          const checklistMatch = normalizedQuery && note.checklist?.find(({ text }) => text.toLocaleLowerCase().includes(normalizedQuery))
          const section = note.sectionId && names.get(note.sectionId)
          return <button type="button" className="search-result" key={note.id} onClick={() => {
            if (note.archived) actions.openArchivedNote(note.id)
            else { close(); actions.focusNote(note.id) }
          }}>
            <span className="result-note-icon" style={{ background: NOTE_COLORS[note.color].paper }}>{note.archived ? <Archive size={18} /> : <StickyNote size={20} />}</span>
            <span><strong>{note.title || 'Untitled note'}</strong>
              {(checklistMatch || note.body) && <span>{checklistMatch ? `Checklist · ${checklistMatch.text}` : note.body}</span>}
              {(note.archived || section) && <small>{[note.archived ? 'Archived' : '', section].filter(Boolean).join(' · ')}</small>}
            </span>
          </button>
        })}
        {!results.length && <p className="panel-empty">{normalizedQuery ? 'No notes match that search.' : 'No notes match these filters.'}</p>}
      </div>
    </> : <SectionDirectory sections={sections} close={close} />}
  </Modal>
}
