import { Check } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import type { NoteDefaults, PhotoWorkspace } from '../../types/wall'
import { DEFAULT_NOTE_PREFERENCES } from '../../utils/appearance'
import { PHOTO_WORKSPACES } from '../../utils/photoWorkspaces'
import { NoteColorPicker } from './AppearancePickers'

export function AppearanceSettings() {
  const defaults = useWallStore((state) => state.noteDefaults)
  const workspace = useWallStore((state) => state.appearance.photoWorkspace ?? 'professor')
  const actions = useWallStore.getState()

  return <>
    <section className="settings-section" aria-labelledby="appearance-heading">
      <h3 id="appearance-heading">Themes and appearance</h3>
      <div className="photo-theme-choices" role="group" aria-label="Photo workspace">
        {(Object.keys(PHOTO_WORKSPACES) as PhotoWorkspace[]).map((id) => {
          const { name, asset } = PHOTO_WORKSPACES[id]
          const selected = workspace === id
          const preview = id === 'professor' ? 'wide' : 'tablet-wide'
          return <button key={id} type="button" className="photo-theme-card" aria-pressed={selected}
            onClick={() => {
              if (!selected) actions.setAppearance({ photoWorkspace: id === 'professor' ? undefined : id })
            }}>
            <span className="photo-theme-image" data-workspace={id} aria-hidden="true">
              <picture>
                {id === 'professor' && <source media="(max-width: 560px)" srcSet={`/environments/${asset}-tablet.jpg`} />}
                <img src={`/environments/${asset}-${preview}.jpg`} alt="" loading="lazy" decoding="async" draggable={false}
                  onError={(event) => { event.currentTarget.style.visibility = 'hidden' }}
                  onLoad={(event) => { event.currentTarget.style.visibility = 'visible' }} />
              </picture>
              {selected && <span className="photo-theme-check"><Check size={11} /></span>}
            </span>
            <strong>{name}</strong>
          </button>
        })}
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
