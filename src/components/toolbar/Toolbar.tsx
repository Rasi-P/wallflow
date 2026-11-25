import { useCallback, useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Plus, Undo2, Redo2, Minus, Scan, MousePointer2, Hand, Orbit, Move3D, ChevronDown, X, Check } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { NOTE_COLORS, MAX_NOTES } from '../../utils/constants'
import type { NoteColor } from '../../types/wall'
import { IconButton } from '../ui/IconButton'
import { SelectedNoteTools } from './SelectedNoteTools'
import { countActiveNotes } from '../../utils/noteTasks'
import { useDismissiblePopover } from '../../hooks/useDismissiblePopover'

export function Toolbar() {
  const past = useWallStore((s) => s.past.length)
  const future = useWallStore((s) => s.future.length)
  const color = useWallStore((s) => s.activeColor)
  const mode = useWallStore((s) => s.mode)
  const selected = useWallStore((s) => s.selectedId)
  const editing = useWallStore((s) => s.editingId !== null)
  const count = useWallStore((s) => countActiveNotes(s.notes))
  const [wallControls, setWallControls] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeRotation = useCallback(() => setWallControls(false), [])
  useDismissiblePopover(wallControls, panel, trigger, closeRotation)
  const finishRotation = () => { closeRotation(); trigger.current?.focus({ preventScroll: true }) }
  const actions = useWallStore.getState()

  return <div className="toolbar-area">
    {selected && !editing && <SelectedNoteTools key={selected} id={selected} count={count} />}
    {wallControls && <WallRotation panel={panel} onClose={finishRotation} />}
    <div className="floating-toolbar" role="group" aria-label="Wall tools">
      <button type="button" className="add-note-button" onClick={() => actions.addNote()} disabled={count >= MAX_NOTES} aria-label="Add a note" data-tooltip="Add a note (N)"><Plus size={19} /><span>Add a note</span></button>
      <div className="tool-group history-tools"><IconButton label="Undo" data-tooltip="Undo (Ctrl/⌘ Z)" aria-keyshortcuts="Control+z Meta+z" disabled={!past} onClick={actions.undo}><Undo2 size={18} /></IconButton><IconButton label="Redo" data-tooltip="Redo (Ctrl/⌘ Shift Z)" disabled={!future} onClick={actions.redo}><Redo2 size={18} /></IconButton></div>
      <span className="toolbar-divider" />
      <div className="color-swatches" role="group" aria-label={selected ? 'Selected note color' : 'New note color'}>
        {(Object.keys(NOTE_COLORS) as NoteColor[]).map((key) => <button key={key} className={`color-swatch ${color === key ? 'is-selected' : ''}`} style={{ '--swatch': NOTE_COLORS[key].swatch } as React.CSSProperties}
          aria-label={NOTE_COLORS[key].label} aria-pressed={color === key} data-tooltip={NOTE_COLORS[key].label} onClick={() => actions.chooseColor(key)}><span className="swatch-dot">{color === key && <Check size={11} aria-hidden="true" />}</span></button>)}
      </div>
      <span className="toolbar-divider" />
      <ZoomTools />
    </div>
    <div className="navigation-bar"><div className="mode-switcher" role="group" aria-label="Camera interaction mode">
      <IconButton label="Select and move notes (V)" active={mode === 'select'} onClick={() => actions.setMode('select')}><MousePointer2 size={15} /></IconButton>
      <IconButton label="Pan camera (H)" active={mode === 'pan'} onClick={() => actions.setMode('pan')}><Hand size={15} /></IconButton>
      <IconButton label="Orbit camera (O)" active={mode === 'orbit'} onClick={() => actions.setMode('orbit')}><Orbit size={16} /></IconButton>
    </div><span className="navigation-divider" /><button ref={trigger} type="button" className={`wall-rotation-trigger ${wallControls ? 'is-active' : ''}`}
      onClick={() => setWallControls(!wallControls)} aria-expanded={wallControls} aria-controls={wallControls ? 'wall-rotation' : undefined}><Move3D size={15} /> Rotate wall<ChevronDown size={12} /></button></div>
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
    <IconButton label="Reset camera (0)" onClick={() => commandCamera('reset')}><Scan size={18} /></IconButton>
  </div>
}

function WallRotation({ onClose, panel }: { onClose: () => void; panel: RefObject<HTMLElement | null> }) {
  const rotation = useWallStore((s) => s.wallRotation)
  const [draft, setDraft] = useState(rotation)
  useEffect(() => { setDraft(rotation) }, [rotation])
  const commit = () => useWallStore.getState().rotateWall(draft)
  return <section ref={panel} id="wall-rotation" className="rotation-popover" aria-label="Wall rotation controls">
    <div className="popover-heading"><span><Move3D size={16} /> Wall rotation</span><IconButton label="Close wall rotation" onClick={onClose}><X size={16} /></IconButton></div>
    <label>Tilt <output>{draft[0]}°</output><input data-initial-focus aria-label="Wall tilt" type="range" min="-25" max="25" value={draft[0]} onChange={(e) => setDraft([Number(e.target.value), draft[1]])} /></label>
    <label>Turn <output>{draft[1]}°</output><input aria-label="Wall turn" type="range" min="-30" max="30" value={draft[1]} onChange={(e) => setDraft([draft[0], Number(e.target.value)])} /></label>
    <div className="popover-footer"><button onClick={() => { setDraft([0, 0]); useWallStore.getState().rotateWall([0, 0]) }}>Straighten wall</button><button className="small-primary" onClick={() => { commit(); onClose() }}>Apply rotation</button></div>
  </section>
}
