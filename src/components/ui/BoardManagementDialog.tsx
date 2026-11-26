import { useId, useLayoutEffect, useRef, useState } from 'react'
import { PencilLine, Plus, Trash2 } from 'lucide-react'
import type { BoardId } from '../../types/workspace'
import { useWallStore, workspace } from '../../stores/wallStore'
import { MAX_BOARD_NAME_LENGTH } from '../../utils/constants'
import { storageHealth } from '../../utils/storage'
import { Modal } from './Modal'

type Screen = 'manage' | 'create' | 'rename' | 'delete' | 'session-only'

const titles: Record<Screen, string> = {
  manage: 'Manage boards',
  create: 'Create a board',
  rename: 'Rename board',
  delete: 'Delete board?',
  'session-only': 'Changes saved for this session',
}

export function BoardManagementDialog({ boardId, boardName, canDelete, onClose }: {
  boardId: BoardId; boardName: string; canDelete: boolean; onClose: () => void
}) {
  const [screen, setScreen] = useState<Screen>('manage')
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
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
    if (storageHealth.available) onClose()
    else open('session-only')
  }

  function deleteBoard() {
    if (!canDelete) return
    if (workspace.deleteBoard(boardId)) onClose()
    else setError(storageHealth.available
      ? 'WALLFLOW couldn’t delete this board. Finish any wall gesture and try again.'
      : 'WALLFLOW couldn’t update browser storage. Your board and its contents are still here.')
  }

  return <Modal title={titles[screen]} onClose={onClose} className="board-management-dialog">
    <div ref={content}>
      {screen === 'manage' && <>
        <p className="board-management-summary"><strong>{boardName}</strong></p>
        <div className="board-management-options">
          <button type="button" data-initial-focus className="text-button" onClick={() => open('create')}><Plus size={17} /> Create board</button>
          <button type="button" className="text-button" onClick={() => open('rename')}><PencilLine size={17} /> Rename board</button>
          <button type="button" className="text-button board-delete-option" onClick={() => open('delete')} disabled={!canDelete}><Trash2 size={17} /> Delete board</button>
        </div>
        {!canDelete && <p className="board-management-hint">Keep at least one board in your workspace.</p>}
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
