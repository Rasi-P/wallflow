import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import type { NoteColor } from '../../types/wall'
import { NOTE_COLORS } from '../../utils/constants'
import { useWallStore } from '../../stores/wallStore'
import { photoPaperColors } from '../../utils/photoWorkspaces'

export function NoteColorPicker({ value, onChange }: { value: NoteColor; onChange: (color: NoteColor) => void }) {
  const workspace = useWallStore((s) => s.appearance.photoWorkspace ?? 'professor')
  return <div className="default-note-color">
    <span>Paper color</span>
    <div className="color-swatches" role="group" aria-label="Default note color">
      {photoPaperColors(workspace, value).map((color) => <button type="button" key={color}
        className={`color-swatch${color === value ? ' is-selected' : ''}`} aria-label={NOTE_COLORS[color].label}
        aria-pressed={color === value} data-tooltip={NOTE_COLORS[color].label}
        style={{ '--swatch': NOTE_COLORS[color].swatch } as CSSProperties} onClick={() => onChange(color)}>
        <span className="swatch-dot">{color === value && <Check size={11} aria-hidden="true" />}</span>
      </button>)}
    </div>
  </div>
}
