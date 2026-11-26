import { useWallStore } from '../../stores/wallStore'
import type { NoteDefaults } from '../../types/wall'
import { DEFAULT_NOTE_PREFERENCES } from '../../utils/appearance'
import { NoteColorPicker } from './AppearancePickers'

export function AppearanceSettings() {
  const defaults = useWallStore((state) => state.noteDefaults)
  const actions = useWallStore.getState()

  return <>
    <section className="settings-section" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">Themes and appearance</h3>
      <div className="current-photo-template">
        <img src="/environments/professors-study-wide.jpg" alt="" loading="lazy" />
        <span>Professor’s Study</span>
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
    <button type="button" className="text-button reset-appearance" onClick={() => actions.setNoteDefaults(DEFAULT_NOTE_PREFERENCES)}>Reset note defaults</button>
  </>
}
