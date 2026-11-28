import { Plus, Undo2, Redo2, Minus, Scan, MousePointer2, Hand, Check } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { NOTE_COLORS, MAX_NOTES } from '../../utils/constants'
import type { NoteColor } from '../../types/wall'
import { IconButton } from '../ui/IconButton'
import { SelectedNoteTools } from './SelectedNoteTools'
import { countActiveNotes } from '../../utils/noteTasks'
import { photoPaperColors } from '../../utils/photoWorkspaces'
import { CompactWallTools } from './CompactWallTools'

export function Toolbar({ compact = false }: { compact?: boolean } = {}) {
  const past = useWallStore((s) => s.past.length)
  const future = useWallStore((s) => s.future.length)
  const color = useWallStore((s) => (s.selectedId && s.notes.find((note) => note.id === s.selectedId)?.color) || s.noteDefaults.color)
  const mode = useWallStore((s) => s.mode)
  const selected = useWallStore((s) => s.selectedId)
  const editing = useWallStore((s) => s.editingId !== null)
  const count = useWallStore((s) => countActiveNotes(s.notes))
  const actions = useWallStore.getState()

  return <div className="toolbar-area">
    {selected && !editing && <SelectedNoteTools key={selected} id={selected} count={count} compact={compact} />}
    {compact ? <CompactWallTools color={color} selected={Boolean(selected)} past={past} future={future} count={count} pan={mode === 'pan'}><WallColors color={color} selected={Boolean(selected)} /></CompactWallTools>
      : <div className="floating-toolbar" role="group" aria-label="Wall tools">
      <button type="button" className="add-note-button" data-tour-anchor="add" onClick={() => actions.addNote()} disabled={count >= MAX_NOTES} aria-label="Add a note" data-tooltip="Add a note (N)"><Plus size={19} /><span>Add a note</span></button>
      <div className="tool-group history-tools"><IconButton label="Undo" data-tooltip="Undo (Ctrl/⌘ Z)" aria-keyshortcuts="Control+z Meta+z" disabled={!past} onClick={actions.undo}><Undo2 size={18} /></IconButton><IconButton label="Redo" data-tooltip="Redo (Ctrl/⌘ Shift Z)" disabled={!future} onClick={actions.redo}><Redo2 size={18} /></IconButton></div>
      <span className="toolbar-divider" />
      <WallColors color={color} selected={Boolean(selected)} />
      <span className="toolbar-divider" />
      <div className="photo-view-tools">
        <ZoomTools />
        <div className="mode-switcher" role="group" aria-label="Camera interaction mode">
          <IconButton data-tour-anchor="move" label="Select and move notes (V)" active={mode === 'select'} onClick={() => actions.setMode('select')}><MousePointer2 size={15} /></IconButton>
          <IconButton data-tour-anchor="camera" label="Pan camera (H)" active={mode === 'pan'} onClick={() => actions.setMode('pan')}><Hand size={15} /></IconButton>
        </div>
      </div>
    </div>}
  </div>
}

function WallColors({ color, selected }: { color: NoteColor; selected: boolean }) {
  const workspace = useWallStore((s) => s.appearance.photoWorkspace ?? 'professor')
  return <div className="color-swatches" role="group" aria-label={selected ? 'Selected note color' : 'New note color'}>
    {photoPaperColors(workspace, color).map((key) => <button key={key} type="button" className={`color-swatch ${color === key ? 'is-selected' : ''}`}
      style={{ '--swatch': NOTE_COLORS[key].swatch } as React.CSSProperties} aria-label={NOTE_COLORS[key].label} aria-pressed={color === key}
      data-tooltip={NOTE_COLORS[key].label} onClick={() => useWallStore.getState().chooseColor(key)}><span className="swatch-dot">{color === key && <Check size={11} aria-hidden="true" />}</span></button>)}
  </div>
}

function ZoomTools() {
  const zoom = useWallStore((state) => state.zoomPercent)
  const zoomBounds = useWallStore((state) => state.zoomBounds)
  const commandCamera = useWallStore.getState().commandCamera
  return <div className="tool-group zoom-tools">
    <IconButton label="Zoom out" disabled={zoom <= zoomBounds[0]} onClick={() => commandCamera('zoom', 1.2)}><Minus size={17} /></IconButton>
    <span className="zoom-value" aria-live="off">{zoom}%</span>
    <IconButton label="Zoom in" disabled={zoom >= zoomBounds[1]} onClick={() => commandCamera('zoom', 1 / 1.2)}><Plus size={17} /></IconButton>
    <IconButton data-tour-anchor="camera" label="Reset camera (0)" onClick={() => commandCamera('reset')}><Scan size={18} /></IconButton>
  </div>
}
