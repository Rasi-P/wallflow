import { useId, useLayoutEffect, useRef, useState } from 'react'
import { Link2, PencilLine, Plus, Trash2 } from 'lucide-react'
import type { Board, BoardId } from '../../types/workspace'
import { useWallStore, workspace } from '../../stores/wallStore'
import { MAX_BOARD_NAME_LENGTH, NOTE_COLORS, WALL_HEIGHT, WALL_WIDTH } from '../../utils/constants'
import { storageHealth } from '../../utils/storage'
import { Modal } from './Modal'
import { getNoteSize } from '../../utils/noteDimensions'
import {
  importBrowserBoards, exportBrowserRecovery, exportLinkedChanges, loadSavedLinkedBoard, retryLinkedBoard, useLinkedBoard,
  exportAccountWorkspace, keepLinkedDraft, restoreAccountWorkspace,
} from '../../stores/linkedBoard'

type Screen = 'manage' | 'create' | 'rename' | 'delete' | 'session-only' | 'import'

const titles: Record<Screen, string> = {
  manage: 'Manage boards',
  create: 'Create a board',
  rename: 'Rename board',
  delete: 'Delete board?',
  import: 'Import browser boards',
  'session-only': 'Changes saved for this session',
}

export function BoardManagementDialog({ boardId, boardName, canDelete, onClose }: {
  boardId: BoardId; boardName: string; canDelete: boolean; onClose: () => void
}) {
  const [screen, setScreen] = useState<Screen>('manage')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [preview, setPreview] = useState<Board[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [connecting, setConnecting] = useState(false)
  const account = useLinkedBoard((s) => s.account)
  const importCount = useLinkedBoard((s) => s.importCount ?? 0)
  const hasRecovery = useLinkedBoard((s) => s.hasRecovery)
  const recoveryPending = useLinkedBoard((s) => s.recoveryPending)
  const status = useLinkedBoard((s) => s.status)
  const supabase = useLinkedBoard((s) => s.supabase)
  const accountMessage = useLinkedBoard((s) => s.message)
  const linked = workspace.isLinked(boardId)
  const content = useRef<HTMLDivElement>(null)
  const nameId = useId()

  useLayoutEffect(() => {
    content.current?.querySelector<HTMLElement>('[data-initial-focus]')?.focus({ preventScroll: true })
  }, [screen])

  function open(next: Screen) {
    setError('')
    setDraft(next === 'rename' ? boardName : '')
    setScreen(next)
  }

  function saveBoard() {
    if (!draft.trim()) return
    if (useWallStore.getState().draggingId) {
      setError('Finish the current wall gesture and try again.')
      return
    }
    if (screen === 'create') {
      const id = workspace.createBoard(draft)
      if (!id) return
      workspace.switchBoard(id)
    } else if (!workspace.renameBoard(boardId, draft)) {
      setError('This board is unavailable. Close this dialog and try again.')
      return
    }
    if (linked || storageHealth.available) onClose()
    else open('session-only')
  }

  function reviewBoards() {
    const snapshots = workspace.importableBoards()
    if (!snapshots.length) {
      setError('No saved browser boards are available to import. Reload and try again.')
      return
    }
    setPreview(structuredClone(snapshots))
    setSelected(snapshots.map(({ id }) => id))
    open('import')
  }

  async function confirmImport() {
    if (!selected.length || connecting) return
    setConnecting(true)
    setError('')
    try {
      await importBrowserBoards(preview.filter(({ id }) => selected.includes(id)))
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t import your boards. The browser copies are still saved.')
    } finally {
      setConnecting(false)
    }
  }

  function deleteBoard() {
    if (!canDelete) return
    if (workspace.deleteBoard(boardId)) onClose()
    else setError(storageHealth.available
      ? 'WALLFLOW couldn’t delete this board. Finish any wall gesture and try again.'
      : 'WALLFLOW couldn’t update browser storage. Your board and its contents are still here.')
  }

  async function restoreBackup(file: File) {
    if (!window.confirm('Replace this account workspace with the selected backup? Export the current workspace first if you want to keep a copy.')) return
    try {
      if (file.size > 7_000_000) throw new Error('The workspace backup is too large.')
      await restoreAccountWorkspace(await file.text())
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The workspace backup could not be restored.')
    }
  }

  return <Modal title={titles[screen]} onClose={() => { if (!connecting) onClose() }} className="board-management-dialog">
    <div ref={content}>
      {screen === 'manage' && <>
        <p className="board-management-summary"><strong>{boardName}</strong></p>
        <div className="board-management-options">
          <button type="button" data-initial-focus className="text-button" onClick={() => open('create')}><Plus size={17} /> Create board</button>
          <button type="button" className="text-button" onClick={() => open('rename')}><PencilLine size={17} /> Rename board</button>
          {account && importCount > 0 && <button type="button" className="text-button" onClick={reviewBoards}><Link2 size={17} /> Import browser boards</button>}
          <button type="button" className="text-button board-delete-option" onClick={() => open('delete')} disabled={!canDelete}><Trash2 size={17} /> Delete board</button>
        </div>
        {!canDelete && <p className="board-management-hint">Keep at least one board in your workspace.</p>}
        {linked && <p className="board-management-hint">Saved to {account?.email ?? account?.displayName ?? 'your Google account'}.</p>}
        {linked && accountMessage && <p className="board-management-error" role="alert">{accountMessage}</p>}
        {linked && supabase && <div className="board-management-options">
          <button type="button" className="text-button" onClick={exportAccountWorkspace}>Export account workspace</button>
          <label>Restore workspace backup <input type="file" accept="application/json,.json"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0]
              event.currentTarget.value = ''
              if (file) void restoreBackup(file)
            }} /></label>
        </div>}
        {linked && (status === 'unsaved' || status === 'conflict') && <button type="button" className="text-button" onClick={exportLinkedChanges}>Download unsaved changes</button>}
        {linked && (status === 'unsaved' || status === 'unavailable' || status === 'offline') && <button type="button" className="text-button" onClick={() => void retryLinkedBoard()}>
          {status === 'unsaved' ? 'Retry save' : 'Retry sync'}
        </button>}
        {linked && status === 'conflict' && <button type="button" className="text-button" onClick={() => {
          if (window.confirm('Load the saved account board and discard unsaved changes in this tab?')) void loadSavedLinkedBoard()
        }}>Load saved board</button>}
        {linked && supabase && status === 'conflict' && <button type="button" className="text-button" onClick={() => {
          if (window.confirm('Use your draft for conflicting edits and keep the other nonconflicting changes?')) keepLinkedDraft()
        }}>Keep my conflicting edits</button>}
        {recoveryPending && <>
          <p className="board-management-hint" role="status">A board connection is waiting for verification. Its browser recovery copy is protected.</p>
          <button type="button" className="text-button" onClick={() => void retryLinkedBoard()}>Retry connection check</button>
        </>}
        {linked && hasRecovery && <button type="button" className="text-button" onClick={exportBrowserRecovery}>Download browser recovery copy</button>}
        {error && <p className="board-management-error" role="alert">{error}</p>}
      </>}
      {screen === 'import' && account && <>
        <p className="board-management-hint">Import the selected boards into <strong>{account.email ?? account.displayName ?? account.id}</strong>.</p>
        <p className="board-management-hint">Confirm you’re authorized to import these boards. Your browser copies are kept for recovery. Existing account boards are preserved.</p>
        {preview.map((board) => <section key={board.id}>
          <label className="toggle-label">
            <strong>{board.name}</strong>
            <input type="checkbox" checked={selected.includes(board.id)} disabled={connecting} onChange={(event) => {
              setSelected(event.target.checked ? [...selected, board.id] : selected.filter((id) => id !== board.id))
            }} />
          </label>
          <BoardConnectionPreview board={board} />
        </section>)}
        {error && <p className="board-management-error" role="alert">{error}</p>}
        <div className="board-management-actions">
          <button type="button" className="text-button" data-initial-focus disabled={connecting} onClick={() => open('manage')}>Cancel</button>
          <button type="button" className="primary-button" disabled={connecting || !selected.length} onClick={() => void confirmImport()}>
            {connecting ? 'Importing…' : 'Confirm import'}
          </button>
        </div>
      </>}
      {(screen === 'create' || screen === 'rename') && <form onSubmit={(event) => { event.preventDefault(); saveBoard() }}>
        <label htmlFor={nameId} className="field-label">Board name</label>
        <input id={nameId} className="text-input" data-initial-focus maxLength={MAX_BOARD_NAME_LENGTH} required value={draft}
          onChange={(event) => { setDraft(event.target.value); setError('') }} />
        {error && <p className="board-management-error" role="alert">{error}</p>}
        <div className="board-management-actions">
          <button type="button" className="text-button" onClick={() => open('manage')}>Cancel</button>
          <button type="submit" className="primary-button" disabled={!draft.trim()}>{screen === 'create' ? 'Create board' : 'Save name'}</button>
        </div>
      </form>}
      {screen === 'delete' && <>
        <p className="board-management-summary">This permanently deletes <strong>{boardName}</strong> and all its notes, sections, and reminders.</p>
        {error && <p className="board-management-error" role="alert">{error}</p>}
        <div className="board-management-actions">
          <button type="button" className="text-button" data-initial-focus onClick={() => open('manage')}>Cancel</button>
          <button type="button" className="primary-button board-delete-button" disabled={!canDelete} onClick={deleteBoard}>Delete board</button>
        </div>
      </>}
      {screen === 'session-only' && <>
        <p className="board-management-error" role="alert">WALLFLOW couldn’t save to browser storage. Keep this tab open to retain your changes.</p>
        <div className="board-management-actions"><button type="button" className="primary-button" data-initial-focus onClick={onClose}>Done</button></div>
      </>}
    </div>
  </Modal>
}


function BoardConnectionPreview({ board }: { board: Board }) {
  const notes = board.document.notes.filter((note) => !note.archived)
  const archived = board.document.notes.length - notes.length
  return <>
    <div className="board-connection-preview" role="img" aria-label="Preview of the active note layout">
      {notes.map((note) => {
        const [width, height] = getNoteSize(note)
        return <span key={note.id} style={{
          left: `${50 + 100 * note.position[0] / WALL_WIDTH}%`,
          top: `${50 - 100 * note.position[1] / WALL_HEIGHT}%`,
          width: `${100 * width / WALL_WIDTH}%`,
          height: `${100 * height / WALL_HEIGHT}%`,
          background: NOTE_COLORS[note.color].paper,
          transform: `translate(-50%, -50%) rotate(${-note.rotation}rad)`,
        }} />
      })}
    </div>
    <p className="board-management-hint">{notes.length} active · {archived} archived</p>
    {notes.length > 0 && <ul className="board-management-hint board-connection-titles">
      {notes.slice(0, 3).map((note) => <li key={note.id}>{note.title || note.body || 'Untitled note'}</li>)}
    </ul>}
  </>
}
