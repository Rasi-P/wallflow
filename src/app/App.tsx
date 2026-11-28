import { CircleHelp, FilterX, MousePointer2, Plus, ZoomIn, StickyNote as StickyNoteIcon } from 'lucide-react'
import { lazy, Suspense, useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
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
import type { Account } from '../types/auth'
import type { MountAccountBoard } from '../stores/linkedBoard'
import { retryLinkedBoard, useLinkedBoard } from '../stores/linkedBoard'
import { BOARD_LINK_PREFIX, restoreSourceProtection } from '../utils/boardLinkStorage'
import { captureLinkPending, consumeCaptureLink, rememberCaptureLink } from '../pwa/captureLink'
import { QuickCaptureDialog } from '../components/mobile/QuickCaptureDialog'
import { Modal } from '../components/ui/Modal'
import { AuthLoading, SignIn } from '../auth/SignIn'

const WallScene = lazy(() => import('../three/WallScene'))

function BoardStage({ editorElement, compact }: { editorElement: HTMLDivElement | null; compact: boolean }) {
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
    <SceneErrorBoundary><Suspense fallback={<WallLoading />}><WallScene editorElement={editorElement} compact={compact} /></Suspense></SceneErrorBoundary>
  </div>
}

type WorkspaceProps = {
  account?: Account
  onSignIn?: () => void
  onSignOut?: () => void
}

export function App({ onSessionInvalid, mountAccount, ...props }: WorkspaceProps & {
  onSessionInvalid: () => void
  mountAccount?: MountAccountBoard
}) {
  const { account } = props
  const ready = useWorkspaceStore((state) => state.boardOrder.length > 0)
  const status = useLinkedBoard((state) => state.status)
  const syncError = useLinkedBoard((state) => state.message)
  const [deviceError, setDeviceError] = useState<string>()
  const [deviceRetry, setDeviceRetry] = useState(0)

  useLayoutEffect(() => {
    if (account) return mountAccount?.(account, onSessionInvalid)
    let cancelled = false
    void restoreSourceProtection().then(() => {
      if (!cancelled) workspace.openLocalBoards()
    }, () => {
      if (!cancelled) setDeviceError('WALLFLOW couldn’t check browser recovery storage. Retry to open your boards.')
    })
    const refreshProtection = (event: StorageEvent) => {
      if (event.key !== null && !event.key.startsWith(BOARD_LINK_PREFIX)) return
      void restoreSourceProtection().then(() => {
        if (!cancelled) workspace.revealLocalBoards()
      }).catch(() => {})
    }
    window.addEventListener('storage', refreshProtection)
    return () => {
      cancelled = true
      window.removeEventListener('storage', refreshProtection)
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

const mobileLayout = matchMedia('(max-width: 767px), (max-width: 1023px) and (pointer: coarse)')
const watchLayout = (notify: () => void) => {
  mobileLayout.addEventListener('change', notify)
  return () => mobileLayout.removeEventListener('change', notify)
}

function BoardWorkspace({ account, onSignIn, onSignOut }: WorkspaceProps) {
  useLocalDay()
  useReminderScheduler()
  useKeyboardShortcuts()
  const compact = useSyncExternalStore(watchLayout, () => mobileLayout.matches)
  const [capture, setCapture] = useState(captureLinkPending)
  const closeCapture = () => { consumeCaptureLink(); setCapture(false) }

  useLayoutEffect(() => {
    if (captureLinkPending() && account) consumeCaptureLink()
  }, [account?.id])

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

  return <main className={compact ? "wallflow-app wallflow-app--compact" : "wallflow-app"} data-tour-target={tourTarget}>
    <BoardStage editorElement={compact ? null : editorElement} compact={compact} />
    <Header compact={compact} onCapture={() => setCapture(true)} />
    {tasksOpen && <TasksPanel />}
    {showWelcome && tutorial === null && <Welcome />}
    {tutorial !== null && <WallTutorial progress={tutorial} />}
    {!showWelcome && tutorial === null && !noteCount && !hasSections && <div className="board-empty">
      <span>This board is empty.</span>
      <button type="button" className="text-button" onClick={() => useWallStore.getState().addNote()}><Plus size={16} aria-hidden="true" /> Add your first note</button>
    </div>}
    <Toolbar compact={compact} />
    <footer className="app-footer"><div className="wall-note-count"><StickyNoteIcon size={14} /><span>{noteCount} {noteCount === 1 ? 'note' : 'notes'}</span>
      {filtered && <button type="button" className="clear-wall-filters" onClick={() => useWallStore.getState().setFilters(DEFAULT_FILTERS)}><FilterX size={14} /> Clear filters</button>}
    </div>
      {showHints && <div className="interaction-hints"><span><MousePointer2 size={13} /> Drag notes to make it yours</span><span className="hint-dot">·</span><span><ZoomIn size={13} /> Scroll to zoom</span></div>}
      <button type="button" className="help-trigger" onClick={() => useWallStore.getState().setPanel('helpOpen', true)}><CircleHelp size={17} /><span>Help</span></button>
    </footer>
    {note && (compact
      ? <Modal key={note.id} title="Edit sticky note" className="compact-note-modal" onClose={() => useWallStore.getState().finishEditing(true)}
        headerAction={<button type="button" className="primary-button"
          onClick={() => useWallStore.getState().finishEditing()}>Done</button>}>
        <NoteEditor note={note} anchor={editorAnchor} registerAnchor={registerEditor} compact />
      </Modal>
      : <NoteEditor key={note.id} note={note} anchor={editorAnchor} registerAnchor={registerEditor} />)}
    {searchOpen && <SearchDialog />}
    {settingsOpen && <SettingsDialog mobile={compact} account={account} onSignIn={onSignIn} onSignOut={onSignOut} />}
    {helpOpen && <HelpDialog compact={compact} />}
    {capture && <QuickCaptureDialog onClose={closeCapture} onSignIn={onSignIn && (() => {
      if (!captureLinkPending()) {
        history.replaceState(null, '', '/capture')
        rememberCaptureLink()
      }
      onSignIn()
    })} />}
  </main>
}
