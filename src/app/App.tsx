import { CircleHelp, FilterX, MousePointer2, Plus, ZoomIn, StickyNote as StickyNoteIcon } from 'lucide-react'
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState } from 'react'
import { Header } from '../components/toolbar/Header'
import { Toolbar } from '../components/toolbar/Toolbar'
import { SearchDialog } from '../components/ui/SearchDialog'
import { SettingsDialog } from '../components/ui/SettingsDialog'
import { HelpDialog } from '../components/ui/HelpDialog'
import { NoteEditor } from '../components/sticky-note/NoteEditor'
import { SceneErrorBoundary } from '../components/ui/SceneErrorBoundary'
import { WallLoading } from '../components/ui/WallLoading'
import { useWallStore, useWorkspaceStore, workspace } from '../stores/wallStore'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { useLocalDay } from '../hooks/useLocalDay'
import { useReminderScheduler } from '../hooks/useReminderScheduler'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { TasksPanel } from '../components/ui/TasksPanel'
import { countActiveNotes } from '../utils/noteTasks'
import { DEFAULT_FILTERS, hasWallFilters } from '../utils/noteSearch'
import { Welcome } from '../components/ui/Welcome'
import { WallTutorial } from '../components/ui/WallTutorial'
import { TUTORIAL_STEPS } from '../utils/onboarding'
import type { ActiveSession } from '../auth/session'
import { mountLinkedBoard, retryLinkedBoard, useLinkedBoard } from '../stores/linkedBoard'
import { restoreSourceProtection } from '../utils/boardLinkStorage'
import { AuthLoading, SignIn } from '../auth/SignIn'

const WallScene = lazy(() => import('../three/WallScene'))

function BoardStage({ editorElement }: { editorElement: HTMLDivElement | null }) {
  const activeId = useWorkspaceStore((state) => state.activeBoardId)
  const previous = useRef(activeId)
  const stage = useRef<HTMLDivElement>(null)
  const reducedMotion = useReducedMotion()

  useLayoutEffect(() => {
    if (previous.current === activeId) return
    previous.current = activeId
    useWallStore.getState().commandCamera('reset')
    if (reducedMotion) return
    const fade = stage.current?.animate?.([{ opacity: 0.8 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    return () => fade?.cancel()
  }, [activeId, reducedMotion])

  return <div ref={stage} className="board-stage">
    <SceneErrorBoundary><Suspense fallback={<WallLoading />}><WallScene editorElement={editorElement} /></Suspense></SceneErrorBoundary>
  </div>
}

type WorkspaceProps = {
  session?: ActiveSession
  onSignIn?: () => void
  onSignOut: () => void
  onRetrySession: () => void
}

export function App({ onSessionInvalid, mountAccount = mountLinkedBoard, ...props }: WorkspaceProps & {
  onSessionInvalid: () => void
  mountAccount?: typeof mountLinkedBoard
}) {
  const account = props.session?.user
  const ready = useWorkspaceStore((state) => state.boardOrder.length > 0)
  const status = useLinkedBoard((state) => state.status)
  const syncError = useLinkedBoard((state) => state.message)
  const [deviceError, setDeviceError] = useState<string>()
  const [deviceRetry, setDeviceRetry] = useState(0)

  useLayoutEffect(() => {
    if (account) return mountAccount(account, onSessionInvalid)
    let cancelled = false
    void restoreSourceProtection().then(() => {
      if (!cancelled) workspace.openLocalBoards()
    }, () => {
      if (!cancelled) setDeviceError('WALLFLOW couldn’t check browser recovery storage. Retry to open your boards.')
    })
    return () => {
      cancelled = true
      workspace.closeLocalBoards()
    }
  }, [account?.id, mountAccount, onSessionInvalid, deviceRetry])

  if (ready) return <BoardWorkspace {...props} />
  const notice = account ? status === 'unavailable' && syncError : deviceError
  if (notice) return <SignIn state={{ status: 'error', notice }} onContinue={() => {}}
    onRetry={() => {
      if (account) void retryLinkedBoard()
      else { setDeviceError(undefined); setDeviceRetry((attempt) => attempt + 1) }
    }}
    onExit={account ? props.onSignOut : props.onSignIn} exitLabel={account ? 'Sign out' : 'Back to sign-in'} />
  return <AuthLoading opening />
}

function BoardWorkspace({ session, onSignIn, onSignOut, onRetrySession }: WorkspaceProps) {
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
  const hasSections = useWallStore((s) => s.sections.length > 0)
  const note = useWallStore((s) => s.editingId ? s.notes.find((item) => item.id === s.editingId) : undefined)
  const searchOpen = useWallStore((s) => s.searchOpen)
  const settingsOpen = useWallStore((s) => s.settingsOpen)
  const helpOpen = useWallStore((s) => s.helpOpen)
  const tasksOpen = useWallStore((s) => s.tasksOpen)
  const showHints = useWallStore((s) => s.showHints)
  const filtered = useWallStore((s) => hasWallFilters(s.filters))
  const onboardingComplete = useWallStore((s) => s.onboardingComplete)
  const linked = useWorkspaceStore((s) => workspace.isLinked(s.activeBoardId))
  const showWelcome = !linked && !onboardingComplete
  const tutorial = useWallStore((s) => s.tutorial)
  const tourTarget = typeof tutorial === 'number' ? TUTORIAL_STEPS[tutorial]?.target : undefined

  return <main className="wallflow-app" data-tour-target={tourTarget}>
    <BoardStage editorElement={editorElement} />
    <Header />
    {tasksOpen && <TasksPanel />}
    {showWelcome && tutorial === null && <Welcome />}
    {tutorial !== null && <WallTutorial progress={tutorial} />}
    {!showWelcome && tutorial === null && !noteCount && !hasSections && <div className="board-empty">
      <span>This board is empty.</span>
      <button type="button" className="text-button" onClick={() => useWallStore.getState().addNote()}><Plus size={16} aria-hidden="true" /> Add your first note</button>
    </div>}
    <Toolbar />
    <footer className="app-footer"><div className="wall-note-count"><StickyNoteIcon size={14} /><span>{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
      {filtered && <button type="button" className="clear-wall-filters" onClick={() => useWallStore.getState().setFilters(DEFAULT_FILTERS)}><FilterX size={14} /> Clear filters</button>}
    </div>
      {showHints && <div className="interaction-hints"><span><MousePointer2 size={13} /> Drag notes to make it yours</span><span className="hint-dot">·</span><span><ZoomIn size={13} /> Scroll to zoom</span></div>}
      <button type="button" className="help-trigger" onClick={() => useWallStore.getState().setPanel('helpOpen', true)}><CircleHelp size={17} /><span>Help</span></button>
    </footer>
    {note && <NoteEditor key={note.id} note={note} anchor={editorAnchor} registerAnchor={registerEditor} />}
    {searchOpen && <SearchDialog />}
    {settingsOpen && <SettingsDialog session={session} onSignIn={onSignIn} onSignOut={onSignOut} onRetrySession={onRetrySession} />}
    {helpOpen && <HelpDialog />}
  </main>
}
