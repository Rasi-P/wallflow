import { useState } from 'react'
import { Sun, Sunset, Check } from 'lucide-react'
import { useWallStore } from '../../stores/wallStore'
import { Modal } from './Modal'

export function SettingsDialog() {
  const wallName = useWallStore((s) => s.wallName)
  const lighting = useWallStore((s) => s.lighting)
  const showHints = useWallStore((s) => s.showHints)
  const [name, setName] = useState(wallName)
  const close = () => useWallStore.getState().setPanel('settingsOpen', false)
  return <Modal title="Wall settings" onClose={close} className="settings-modal">
    <form onSubmit={(e) => { e.preventDefault(); useWallStore.getState().setWallName(name); close() }}>
      <label className="field-label" htmlFor="wall-name">Wall name</label><input id="wall-name" className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
      <span className="field-label">Lighting</span>
      <div className="lighting-options"><button type="button" className={lighting === 'daylight' ? 'is-selected' : ''} aria-pressed={lighting === 'daylight'} onClick={() => useWallStore.getState().setLighting('daylight')}><Sun size={23} /><strong>Soft daylight</strong></button><button type="button" className={lighting === 'warm' ? 'is-selected' : ''} aria-pressed={lighting === 'warm'} onClick={() => useWallStore.getState().setLighting('warm')}><Sunset size={23} /><strong>Golden hour</strong></button></div>
      <label className="toggle-label"><strong>Show movement hints</strong><input type="checkbox" role="switch" checked={showHints} onChange={(e) => useWallStore.getState().setShowHints(e.target.checked)} /></label>
      <p className="local-note">Your notes and settings are saved in this browser, on this device.</p>
      <button type="submit" className="primary-button settings-save"><Check size={16} /> Done</button>
    </form>
  </Modal>
}
