import { useCallback, useRef, useState } from 'react'
import { Archive, Check, Copy, ListChecks, LocateFixed, Minus, Palette, PencilLine, Plus, RotateCw, Scaling, Trash2, X } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { MAX_NOTES, NOTE_COLORS, NOTE_HEIGHT, NOTE_WIDTH } from '../../utils/constants'
import { getNoteSize } from '../../utils/noteDimensions'
import { IconButton } from '../ui/IconButton'
import { useDismissiblePopover } from '../../hooks/useDismissiblePopover'
import { photoPaperColors } from '../../utils/photoWorkspaces'

export function SelectedNoteTools({ id, count, compact = false }: { id: string; count: number; compact?: boolean }) {
  const note = useWallStore((state) => state.notes.find((entry) => entry.id === id))
  const workspace = useWallStore((state) => state.appearance.photoWorkspace ?? 'professor')
  const sections = useWallStore((state) => state.sections)
  const [panel, setPanel] = useState<'color' | 'size' | 'tasks' | null>(null)
  const popover = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => setPanel(null), [])
  useDismissiblePopover(panel, popover, trigger, close)
  if (!note) return null
  const actions = useWallStore.getState()
  const [width, height] = getNoteSize(note)
  const percent = Math.round(width / NOTE_WIDTH * 100)
  function toggle(next: NonNullable<typeof panel>, button: HTMLButtonElement) {
    trigger.current = button
    setPanel(panel === next ? null : next)
  }

  return <div className="selected-note-tools">
    {panel === 'color' && <div ref={popover} id="note-action-popover" className="note-action-popover color-swatches" role="group" aria-label="Note colors">
      {photoPaperColors(workspace, note.color).map((color) => <button type="button" key={color}
        className={`color-swatch ${note.color === color ? 'is-selected' : ''}`}
        style={{ '--swatch': NOTE_COLORS[color].swatch } as React.CSSProperties}
        aria-label={NOTE_COLORS[color].label} aria-pressed={note.color === color}
        onClick={() => actions.chooseColor(color)}><span className="swatch-dot" /></button>)}
    </div>}
    {panel === 'size' && <div ref={popover} id="note-action-popover" className="note-action-popover note-size-tools" role="group" aria-label="Note size">
      <IconButton label="Make note smaller" disabled={percent <= 65} onClick={() => actions.updateNote(id, { size: [width / 1.12, height / 1.12] })}><Minus size={16} /></IconButton>
      <output>{percent}%</output>
      <IconButton label="Make note larger" disabled={percent >= 220} onClick={() => actions.updateNote(id, { size: [width * 1.12, height * 1.12] })}><Plus size={16} /></IconButton>
      <button type="button" onClick={() => actions.updateNote(id, { size: [NOTE_WIDTH, NOTE_HEIGHT] })}>Reset</button>
    </div>}
    {panel === 'tasks' && <div ref={popover} id="note-action-popover" className="note-action-popover note-task-menu" role="group" aria-label="Note options">
      {!compact && <button type="button" className="text-button" onClick={() => { actions.focusNote(id); setPanel(null) }}><LocateFixed size={16} /> Focus note</button>}
      <button type="button" className="text-button" onClick={() => actions.editNote(id, true)}><ListChecks size={16} /> Edit task details</button>
      <button type="button" className="text-button" onClick={() => actions.updateTask(id, { completed: !note.completed })}><Check size={16} /> {note.completed ? 'Reopen task' : 'Mark complete'}</button>
      <button type="button" className="text-button" onClick={() => actions.archiveNote(id)}><Archive size={16} /> Archive note</button>
      {compact && <>
        <button type="button" className="text-button" onClick={() => actions.updateNote(id, { rotation: (note.rotation - Math.PI / 12) % (Math.PI * 2) })}><RotateCw size={16} /> Rotate note</button>
        <button type="button" className="text-button" disabled={count >= MAX_NOTES} onClick={() => actions.duplicateNote(id)}><Copy size={16} /> Duplicate note</button>
        <button type="button" className="text-button" onClick={() => actions.deleteNote(id)}><Trash2 size={16} /> Delete selected note</button>
        <button type="button" className="text-button" onClick={() => actions.select(null)}><X size={16} /> Deselect note</button>
      </>}
      {sections.length > 0 && <label className="note-section-field">Section
        <select value={note.sectionId ?? ''} onChange={(event) => actions.assignSection(id, event.target.value || undefined)}>
          <option value="">Unassigned</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.name}</option>)}
        </select>
      </label>}
    </div>}
    <div className="selection-actions" role="group" aria-label="Selected note actions">
      {compact && <IconButton label="Focus note" onClick={() => actions.focusNote(id)}><LocateFixed size={16} /></IconButton>}
      <IconButton data-tour-anchor="edit" label="Edit note" onClick={() => actions.editNote(id)}><PencilLine size={16} /></IconButton>
      <IconButton label="Change note color" active={panel === 'color'} aria-expanded={panel === 'color'}
        aria-controls={panel === 'color' ? 'note-action-popover' : undefined} onClick={(event) => toggle('color', event.currentTarget)}><Palette size={17} /></IconButton>
      {!compact && <IconButton label="Rotate note 15 degrees clockwise" onClick={() => actions.updateNote(id, { rotation: (note.rotation - Math.PI / 12) % (Math.PI * 2) })}><RotateCw size={17} /></IconButton>}
      <IconButton data-tour-anchor="resize" label="Resize note" active={panel === 'size'} aria-expanded={panel === 'size'}
        aria-controls={panel === 'size' ? 'note-action-popover' : undefined} onClick={(event) => toggle('size', event.currentTarget)}><Scaling size={17} /></IconButton>
      <IconButton label="Note options" active={panel === 'tasks'} aria-expanded={panel === 'tasks'}
        aria-controls={panel === 'tasks' ? 'note-action-popover' : undefined} onClick={(event) => toggle('tasks', event.currentTarget)}><ListChecks size={17} /></IconButton>
      {!compact && <IconButton label="Duplicate note (⌘/Ctrl+D)" disabled={count >= MAX_NOTES} onClick={() => actions.duplicateNote(id)}><Copy size={16} /></IconButton>}
      {!compact && <IconButton label="Delete selected note" onClick={() => actions.deleteNote(id)}><Trash2 size={16} /></IconButton>}
      {!compact && <IconButton label="Deselect note" onClick={() => actions.select(null)}><X size={16} /></IconButton>}
    </div>
  </div>
}
