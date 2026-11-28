import { useCallback, useId, useRef, useState } from 'react'
import { Hand, House, Minus, MousePointer2, Plus, Redo2, Scan, SlidersHorizontal, Undo2 } from 'lucide-react'
import { useDismissiblePopover } from '../../hooks/useDismissiblePopover'
import { useWallStore } from '../../stores/wallStore'
import { MAX_NOTES, NOTE_COLORS } from '../../utils/constants'
import type { NoteColor } from '../../types/wall'
import { IconButton } from '../ui/IconButton'
import type { ReactNode } from 'react'

export function CompactWallTools({ color, selected, past, future, count, pan, children }: {
  color: NoteColor; selected: boolean; past: number; future: number; count: number; pan: boolean; children: ReactNode
}) {
  const zoom = useWallStore((state) => state.zoomPercent)
  const bounds = useWallStore((state) => state.zoomBounds)
  const { addNote, commandCamera, redo, setMode, undo } = useWallStore.getState()
  const [open, setOpen] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  const close = useCallback(() => setOpen(false), [])
  useDismissiblePopover(open, panel, trigger, close)

  return <div className="floating-toolbar compact-wall-tools" role="group" aria-label="Wall tools">
    <IconButton className="compact-add" data-tour-anchor="add" label="Add a note" disabled={count >= MAX_NOTES} onClick={addNote}>
      <Plus size={21} />
    </IconButton>
    <IconButton label="Undo" disabled={!past} onClick={undo}><Undo2 size={18} /></IconButton>
    <div className="tool-group compact-zoom">
      <output className="sr-only" aria-label="Wall zoom">{zoom}%</output>
      <IconButton label="Zoom out" disabled={zoom <= bounds[0]} onClick={() => commandCamera('zoom', 1.2)}><Minus size={17} /></IconButton>
      <IconButton label="Zoom in" disabled={zoom >= bounds[1]} onClick={() => commandCamera('zoom', 1 / 1.2)}><Plus size={17} /></IconButton>
    </div>
    <IconButton data-tour-anchor="camera" label="Fit whole board" onClick={() => commandCamera('overview')}><Scan size={19} /></IconButton>
    <IconButton ref={trigger} data-tour-anchor="move" label="More wall tools" aria-expanded={open}
      aria-controls={open ? id : undefined} active={open || pan} onClick={() => setOpen(!open)}><SlidersHorizontal size={18} /></IconButton>
    {open && <div ref={panel} id={id} className="compact-wall-popover" role="group" aria-label="More wall tools">
      <div className="compact-paper">
        <span>{selected ? 'Selected note color' : 'New note color'} · {NOTE_COLORS[color].label}</span>
        {children}
      </div>
      <button type="button" className="text-button" aria-pressed={pan}
        onClick={() => { setMode(pan ? 'select' : 'pan'); close() }}>
        {pan ? <MousePointer2 size={17} /> : <Hand size={17} />}{pan ? 'Select and move notes' : 'Pan with one finger'}
      </button>
      <button type="button" className="text-button" onClick={() => { commandCamera('reset'); close() }}><House size={17} /> Reset view</button>
      <button type="button" className="text-button" disabled={!future} onClick={() => { redo(); close() }}><Redo2 size={17} /> Redo</button>
    </div>}
  </div>
}
