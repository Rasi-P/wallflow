import { useWallStore } from '../../stores/wallStore'
import type { NoteDefaults, WallAppearance } from '../../types/wall'
import { AMBIENCE_OPTIONS, LIGHT_INTENSITY_STEP, MAX_LIGHT_INTENSITY, MIN_LIGHT_INTENSITY, WALL_SHADES } from '../../utils/appearance'
import { NoteColorPicker, ThemePicker } from './AppearancePickers'

export function AppearanceSettings() {
  const appearance = useWallStore((s) => s.appearance)
  const defaults = useWallStore((s) => s.noteDefaults)
  const lighting = useWallStore((s) => s.lighting)
  const actions = useWallStore.getState()

  return <>
    <section className="settings-section" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">Themes and appearance</h3>
      <ThemePicker value={appearance.theme} onChange={(theme) => actions.setAppearance({ theme })} />
      <div className="appearance-fields">
        <label>Wall shade<select value={appearance.shade} onChange={(event) => actions.setAppearance({ shade: event.target.value as WallAppearance['shade'] })}>
          {Object.entries(WALL_SHADES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label>Ambience<select value={appearance.ambience} onChange={(event) => actions.setAppearance({ ambience: event.target.value as WallAppearance['ambience'] })}>
          {Object.entries(AMBIENCE_OPTIONS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select></label>
        <label>Lighting tone<select value={lighting} onChange={(event) => actions.setLighting(event.target.value === 'warm' ? 'warm' : 'daylight')}>
          <option value="daylight">{appearance.theme === 'minimal' ? 'Soft daylight' : 'Theme lighting'}</option>
          <option value="warm">Golden hour</option>
        </select></label>
        <div className="appearance-slider"><span><label htmlFor="wall-light-intensity">Light intensity</label><output>{appearance.intensity}%</output></span>
          <input id="wall-light-intensity" type="range" min={MIN_LIGHT_INTENSITY} max={MAX_LIGHT_INTENSITY} step={LIGHT_INTENSITY_STEP}
            value={appearance.intensity} aria-valuetext={`${appearance.intensity}%`}
            onChange={(event) => actions.setAppearance({ intensity: Number(event.target.value) })} />
        </div>
      </div>
    </section>
    <section className="settings-section" aria-labelledby="note-defaults-heading">
      <h3 id="note-defaults-heading">New notes</h3>
      <NoteColorPicker value={defaults.color} onChange={(color) => actions.setNoteDefaults({ color })} />
      <div className="appearance-fields">
        <label>Title lettering<select value={defaults.typography} onChange={(event) => actions.setNoteDefaults({ typography: event.target.value as NoteDefaults['typography'] })}>
          <option value="handwritten">Handwritten</option><option value="sans">DM Sans</option>
        </select></label>
        <label>Paper size<select value={defaults.size} onChange={(event) => actions.setNoteDefaults({ size: event.target.value as NoteDefaults['size'] })}>
          <option value="compact">Compact</option><option value="standard">Standard</option><option value="large">Large</option>
        </select></label>
        <label>Rotation<select value={defaults.rotation} onChange={(event) => actions.setNoteDefaults({ rotation: event.target.value as NoteDefaults['rotation'] })}>
          <option value="varied">Slightly varied</option><option value="straight">Straight</option>
        </select></label>
      </div>
    </section>
    <button type="button" className="text-button reset-appearance" onClick={actions.resetAppearance}>Reset appearance and note defaults</button>
  </>
}
