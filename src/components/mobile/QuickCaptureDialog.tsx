import { Check, ListTodo, Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { captureAccountNote, changeAccountCapture, retryLinkedBoard, useLinkedBoard } from '../../stores/linkedBoard'
import { useWallStore, useWorkspaceStore } from '../../stores/wallStore'
import { MAX_BODY_LENGTH } from '../../utils/constants'
import { MAX_CHECKLIST_ITEMS, MAX_ITEM_LENGTH } from '../../utils/noteTasks'
import { Modal } from '../ui/Modal'

export function QuickCaptureDialog({ onClose, onSignIn }: { onClose: () => void; onSignIn?: () => void }) {
  const [text, setText] = useState('')
  const [checklist, setChecklist] = useState('')
  const [withChecklist, setWithChecklist] = useState(false)
  const [target, setTarget] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const capture = useLinkedBoard((state) => state.capture)
  const linked = useLinkedBoard((state) => state.linked)
  const boards = useWorkspaceStore((state) => state.boards)
  const boardOrder = useWorkspaceStore((state) => state.boardOrder)
  const activeBoard = useWorkspaceStore((state) => state.activeBoardId)
  const items = checklist.split('\n').map((item) => item.trim()).filter(Boolean)
  const invalidChecklist = withChecklist && (items.length > MAX_CHECKLIST_ITEMS || items.some((item) => item.length > MAX_ITEM_LENGTH))

  async function submit() {
    if (!linked || submitting.current || (!text.trim() && !items.length) || invalidChecklist) return
    setNotice('')
    submitting.current = true
    setBusy(true)
    try {
      useWallStore.getState().finishEditing()
      await captureAccountNote({ content: text, boardId: target || activeBoard, checklist: withChecklist ? items : undefined })
      setText('')
      setChecklist('')
    } catch (failure) {
      setNotice(failure instanceof Error ? failure.message : 'Capture could not be saved on this device.')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }

  async function change(id: string, retry: boolean) {
    if (!retry && !window.confirm('Discard this failed capture from this device?')) return
    try { await changeAccountCapture(id, retry) }
    catch { setNotice('The pending capture could not be changed. Retry when browser storage is available.') }
  }

  return <Modal title="Quick Capture" className="capture-dialog" onClose={onClose}>
    {!linked ? <div className="capture-content">
      <p>Sign in with Google to capture notes in your account workspace.</p>
      {onSignIn && <button type="button" className="primary-button" onClick={onSignIn}>Sign in</button>}
    </div> : <div className="capture-content">
      <form onSubmit={(event) => { event.preventDefault(); void submit() }}>
        <label className="mobile-field">Note
          <textarea data-initial-focus rows={4} maxLength={MAX_BODY_LENGTH} value={text} placeholder="What’s on your mind?"
            disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        <div className="capture-form-tools">
          <button type="button" className="text-button" aria-expanded={withChecklist} onClick={() => setWithChecklist(!withChecklist)}>
            <ListTodo size={17} /> {withChecklist ? 'Hide checklist' : 'Add checklist'}
          </button>
          <small>{text.length}/{MAX_BODY_LENGTH}</small>
        </div>
        {withChecklist && <label className="mobile-field">Checklist · one item per line
          <textarea rows={3} value={checklist} disabled={busy} onChange={(event) => setChecklist(event.target.value)} />
        </label>}
        <label className="mobile-field">Board
          <select value={target} disabled={busy} onChange={(event) => setTarget(event.target.value)}>
            <option value="">Current board · {boards[activeBoard]?.name}</option>
            {boardOrder.map((id) => <option key={id} value={id}>{boards[id].name}</option>)}
          </select>
        </label>
        {invalidChecklist && <p role="alert">Use up to 24 checklist items of 120 characters each.</p>}
        <button className="primary-button capture-submit" disabled={busy || (!text.trim() && (!withChecklist || !items.length)) || invalidChecklist}>
          <Send size={17} /> {busy ? 'Saving…' : 'Capture note'}
        </button>
      </form>
      {notice && <p role="alert">{notice}</p>}
      {capture?.error && <p role="alert">{capture.error}</p>}
      <div className="capture-feedback" role="status">
        {capture?.message && <><Check size={15} />{capture.message}</>}
      </div>
      {Boolean(capture?.entries.length) && <section aria-label="Capture outbox" className="capture-outbox">
        <h3>Capture outbox</h3>
        <ul>{capture?.entries.map((entry) => <li key={entry.id}>
          <div><strong>{entry.content || entry.checklist?.[0]}</strong>
            <small>{entry.error ?? (capture.sending === entry.id ? 'Syncing…' : 'Pending sync')}</small></div>
          {entry.error && <div>
            <button type="button" className="text-button" onClick={() => void change(entry.id, true)}>Retry</button>
            <button type="button" className="text-button" onClick={() => void change(entry.id, false)}>Discard</button>
          </div>}
        </li>)}</ul>
        {capture?.entries.some((entry) => !entry.error) && <button type="button" className="text-button"
          onClick={() => void retryLinkedBoard()}>Retry sync</button>}
      </section>}
    </div>}
  </Modal>
}
