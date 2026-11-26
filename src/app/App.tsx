import { CircleHelp, FilterX, MousePointer2, ZoomIn, StickyNote as StickyNoteIcon } from 'lucide-react'
import { lazy, Suspense, useCallback, useRef, useState } from 'react'
import { Header } from '../components/toolbar/Header'
import { Toolbar } from '../components/toolbar/Toolbar'
import { SearchDialog } from '../components/ui/SearchDialog'
import { SettingsDialog } from '../components/ui/SettingsDialog'
import { HelpDialog } from '../components/ui/HelpDialog'
import { NoteEditor } from '../components/sticky-note/NoteEditor'
import { SceneErrorBoundary } from '../components/ui/SceneErrorBoundary'
import { WallLoading } from '../components/ui/WallLoading'
import { useWallStore } from '../stores/wallStore'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useLocalDay } from '../hooks/useLocalDay'
import { useReminderScheduler } from '../hooks/useReminderScheduler'
import { TasksPanel } from '../components/ui/TasksPanel'
import { countActiveNotes } from '../utils/noteTasks'
import { DEFAULT_FILTERS, hasWallFilters } from '../utils/noteSearch'
import { Welcome } from '../components/ui/Welcome'
import { WallTutorial } from '../components/ui/WallTutorial'
import { TUTORIAL_STEPS } from '../utils/onboarding'
import type { ActiveSession } from '../auth/session'

const WallScene = lazy(() => import('../three/WallScene'))

export function App({ session, onSignOut }: { session: ActiveSession; onSignOut: () => void }) {
  useKeyboardShortcuts()
  useLocalDay()
  useReminderScheduler()
  const editorAnchor = useRef<HTMLDivElement>(null)
  const [editorElement, setEditorElement] = useState<HTMLDivElement | null>(null)
  const registerEditor = useCallback((element: HTMLDivElement | null) => {
    editorAnchor.current = element
    setEditorElement(element)
  }, [])
  const noteCount = useWallStore((s) => countActiveNotes(s.notes))
  const note = useWallStore((s) => s.editingId ? s.notes.find((item) => item.id === s.editingId) : undefined)
  const searchOpen = useWallStore((s) => s.searchOpen)
  const settingsOpen = useWallStore((s) => s.settingsOpen)
  const helpOpen = useWallStore((s) => s.helpOpen)
  const tasksOpen = useWallStore((s) => s.tasksOpen)
  const showHints = useWallStore((s) => s.showHints)
  const filtered = useWallStore((s) => hasWallFilters(s.filters))
  const onboardingComplete = useWallStore((s) => s.onboardingComplete)
  const tutorial = useWallStore((s) => s.tutorial)
  const tourTarget = typeof tutorial === 'number' ? TUTORIAL_STEPS[tutorial]?.target : undefined

  return <main className="wallflow-app" data-tour-target={tourTarget}>
    <SceneErrorBoundary><Suspense fallback={<WallLoading />}><WallScene editorElement={editorElement} /></Suspense></SceneErrorBoundary>
    <Header />
    {tasksOpen && <TasksPanel />}
    {!onboardingComplete && tutorial === null && <Welcome />}
    {tutorial !== null && <WallTutorial progress={tutorial} />}
    <Toolbar />
    <footer className="app-footer"><div className="wall-note-count"><StickyNoteIcon size={14} /><span>{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
      {filtered && <button type="button" className="clear-wall-filters" onClick={() => useWallStore.getState().setFilters(DEFAULT_FILTERS)}><FilterX size={14} /> Clear filters</button>}
    </div>
      {showHints && <div className="interaction-hints"><span><MousePointer2 size={13} /> Drag notes to make it yours</span><span className="hint-dot">·</span><span><ZoomIn size={13} /> Scroll to zoom</span></div>}
      <button type="button" className="help-trigger" onClick={() => useWallStore.getState().setPanel('helpOpen', true)}><CircleHelp size={17} /><span>Help</span></button>
    </footer>
    {note && <NoteEditor key={note.id} note={note} anchor={editorAnchor} registerAnchor={registerEditor} />}
    {searchOpen && <SearchDialog />}
    {settingsOpen && <SettingsDialog session={session} onSignOut={onSignOut} />}
    {helpOpen && <HelpDialog />}
  </main>
}
