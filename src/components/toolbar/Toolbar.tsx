import { useCallback, useId, useRef, useState } from 'react'
import { Plus, Undo2, Redo2, Minus, Scan, MousePointer2, Hand, Check, House } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { NOTE_COLORS, MAX_NOTES } from '../../utils/constants'
import type { NoteColor } from '../../types/wall'
import { IconButton } from '../ui/IconButton'
import { SelectedNoteTools } from './SelectedNoteTools'
import { countActiveNotes } from '../../utils/noteTasks'
import { useStudyPhone } from '../../hooks/useStudyPhone'
import { useDismissiblePopover } from '../../hooks/useDismissiblePopover'
import { photoPaperColors } from '../../utils/photoWorkspaces'

export function Toolbar() {
  const past = useWallStore((s) => s.past.length)
  const future = useWallStore((s) => s.future.length)
  const color = useWallStore((s) => (s.selectedId && s.notes.find((note) => note.id === s.selectedId)?.color) || s.noteDefaults.color)
  const mode = useWallStore((s) => s.mode)
  const selected = useWallStore((s) => s.selectedId)
  const editing = useWallStore((s) => s.editingId !== null)
  const count = useWallStore((s) => countActiveNotes(s.notes))
  const actions = useWallStore.getState()
  const phone = useStudyPhone()

  return <div className="toolbar-area">
    {selected && !editing && <SelectedNoteTools key={selected} id={selected} count={count} />}
    <div className={`floating-toolbar${phone ? ' phone-study-toolbar' : ''}`} role="group" aria-label="Wall tools">
      <button type="button" className="add-note-button" data-tour-anchor="add" onClick={() => actions.addNote()} disabled={count >= MAX_NOTES} aria-label="Add a note" data-tooltip="Add a note (N)"><Plus size={19} /><span>{phone ? 'Add' : 'Add a note'}</span></button>
      <div className="tool-group history-tools"><IconButton label="Undo" data-tooltip="Undo (Ctrl/⌘ Z)" aria-keyshortcuts="Control+z Meta+z" disabled={!past} onClick={actions.undo}><Undo2 size={18} /></IconButton><IconButton label="Redo" data-tooltip="Redo (Ctrl/⌘ Shift Z)" disabled={!future} onClick={actions.redo}><Redo2 size={18} /></IconButton></div>
      <span className="toolbar-divider" />
      {phone ? <PhoneColors color={color} selected={Boolean(selected)} /> : <WallColors color={color} selected={Boolean(selected)} />}
      <span className="toolbar-divider" />
      {phone ? <>
        <ZoomTools phone />
        <IconButton data-tour-anchor="move" label={mode === 'pan' ? 'Select and move notes' : 'Pan camera'} active={mode === 'pan'}
          onClick={() => actions.setMode(mode === 'pan' ? 'select' : 'pan')}><Hand size={17} /></IconButton>
      </> : <div className="photo-view-tools">
        <ZoomTools />
        <div className="mode-switcher" role="group" aria-label="Camera interaction mode">
          <IconButton data-tour-anchor="move" label="Select and move notes (V)" active={mode === 'select'} onClick={() => actions.setMode('select')}><MousePointer2 size={15} /></IconButton>
          <IconButton data-tour-anchor="camera" label="Pan camera (H)" active={mode === 'pan'} onClick={() => actions.setMode('pan')}><Hand size={15} /></IconButton>
        </div>
      </div>}
    </div>
  </div>
}

function WallColors({ color, selected, onChange = useWallStore.getState().chooseColor }: {
  color: NoteColor; selected: boolean; onChange?: (color: NoteColor) => void
}) {
  const workspace = useWallStore((s) => s.appearance.photoWorkspace ?? 'professor')
  return <div className="color-swatches" role="group" aria-label={selected ? 'Selected note color' : 'New note color'}>
    {photoPaperColors(workspace, color).map((key) => <button key={key} type="button" className={`color-swatch ${color === key ? 'is-selected' : ''}`}
      style={{ '--swatch': NOTE_COLORS[key].swatch } as React.CSSProperties} aria-label={NOTE_COLORS[key].label} aria-pressed={color === key}
      data-tooltip={NOTE_COLORS[key].label} onClick={() => onChange(key)}><span className="swatch-dot">{color === key && <Check size={11} aria-hidden="true" />}</span></button>)}
  </div>
}

function PhoneColors({ color, selected }: { color: NoteColor; selected: boolean }) {
  const id = useId()
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  useDismissiblePopover(open, panel, trigger, close)
  return <div className="phone-paper-colors">
    <button ref={trigger} type="button" className="icon-button phone-color-trigger" aria-label={`Paper colors, ${NOTE_COLORS[color].label}`}
      style={{ '--swatch': NOTE_COLORS[color].swatch } as React.CSSProperties} aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => setOpen(!open)}><span className="swatch-dot" /></button>
    {open && <div ref={panel} id={id} className="phone-colors-popover">
      <WallColors color={color} selected={selected} onChange={(next) => {
        useWallStore.getState().chooseColor(next)
        close()
        trigger.current?.focus({ preventScroll: true })
      }} />
    </div>}
  </div>
}

function ZoomTools({ phone = false }: { phone?: boolean }) {
  const zoom = useWallStore((state) => state.zoomPercent)
  const zoomBounds = useWallStore((state) => state.zoomBounds)
  const commandCamera = useWallStore.getState().commandCamera
  return <div className="tool-group zoom-tools">
    <IconButton label="Zoom out" disabled={zoom <= zoomBounds[0]} onClick={() => commandCamera('zoom', 1.2)}><Minus size={17} /></IconButton>
    {phone ? <IconButton className="phone-study-home zoom-value" label="Return to default view"
      onClick={() => commandCamera('reset')}><House size={12} /><span>{zoom}%</span></IconButton>
      : <span className="zoom-value" aria-live="off">{zoom}%</span>}
    <IconButton label="Zoom in" disabled={zoom >= zoomBounds[1]} onClick={() => commandCamera('zoom', 1 / 1.2)}><Plus size={17} /></IconButton>
    <IconButton data-tour-anchor="camera" label={phone ? 'Fit whole board' : 'Reset camera (0)'} onClick={() => commandCamera(phone ? 'overview' : 'reset')}><Scan size={18} /></IconButton>
  </div>
}
