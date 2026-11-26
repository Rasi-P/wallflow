import type { CSSProperties } from 'react'
import { Check } from 'lucide-react'
import type { EnvironmentTheme, NoteColor } from '../../types/wall'
import { THEME_PRESETS } from '../../utils/appearance'
import { NOTE_COLORS } from '../../utils/constants'

export function ThemePicker({ value, onChange }: { value: EnvironmentTheme; onChange: (theme: EnvironmentTheme) => void }) {
  return <div className="theme-previews" role="group" aria-label="Environment theme">
    {(Object.entries(THEME_PRESETS) as [EnvironmentTheme, typeof THEME_PRESETS.minimal][]).map(([id, theme]) => {
      const selected = value === id
      return <button key={id} type="button" className="theme-preview" aria-pressed={selected} onClick={() => onChange(id)}>
        <span aria-hidden="true" data-theme={id} className="theme-preview-sample"
          style={{ '--preview-surround': theme.background, '--preview-wall': theme.wall, '--preview-trim': theme.trim ?? 'transparent' } as CSSProperties}>
          <span className="theme-preview-plaster"><span /><span /></span>
        </span>
        <span className="theme-preview-title">{theme.name}{selected && <Check size={15} aria-hidden="true" />}</span>
      </button>
    })}
  </div>
}

export function NoteColorPicker({ value, onChange }: { value: NoteColor; onChange: (color: NoteColor) => void }) {
  return <div className="default-note-color">
    <span>Paper color</span>
    <div className="color-swatches" role="group" aria-label="Default note color">
      {(Object.keys(NOTE_COLORS) as NoteColor[]).map((color) => <button type="button" key={color}
        className={`color-swatch${color === value ? ' is-selected' : ''}`} aria-label={NOTE_COLORS[color].label}
        aria-pressed={color === value} data-tooltip={NOTE_COLORS[color].label}
        style={{ '--swatch': NOTE_COLORS[color].swatch } as CSSProperties} onClick={() => onChange(color)}>
        <span className="swatch-dot">{color === value && <Check size={11} aria-hidden="true" />}</span>
      </button>)}
    </div>
  </div>
}
