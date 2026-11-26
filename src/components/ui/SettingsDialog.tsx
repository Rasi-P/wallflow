import { useState } from 'react'
import { Sun, Sunset, Check, LogOut } from 'lucide-react'
import type { ActiveSession } from '../../auth/session'
import { useWallStore } from '../../stores/wallStore'
import { Modal } from './Modal'

export function SettingsDialog({ session, onSignOut }: { session: ActiveSession; onSignOut: () => void }) {
  const wallName = useWallStore((s) => s.wallName)
  const lighting = useWallStore((s) => s.lighting)
  const showHints = useWallStore((s) => s.showHints)
  const [name, setName] = useState(wallName)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const close = () => useWallStore.getState().setPanel('settingsOpen', false)
  return <Modal title="Wall settings" onClose={close} className="settings-modal">
    <form onSubmit={(e) => { e.preventDefault(); useWallStore.getState().setWallName(name); close() }}>
      <label className="field-label" htmlFor="wall-name">Wall name</label><input id="wall-name" className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
      <span className="field-label">Lighting</span>
      <div className="lighting-options"><button type="button" className={lighting === 'daylight' ? 'is-selected' : ''} aria-pressed={lighting === 'daylight'} onClick={() => useWallStore.getState().setLighting('daylight')}><Sun size={23} /><strong>Soft daylight</strong></button><button type="button" className={lighting === 'warm' ? 'is-selected' : ''} aria-pressed={lighting === 'warm'} onClick={() => useWallStore.getState().setLighting('warm')}><Sunset size={23} /><strong>Golden hour</strong></button></div>
      <label className="toggle-label"><strong>Show movement hints</strong><input type="checkbox" role="switch" checked={showHints} onChange={(e) => useWallStore.getState().setShowHints(e.target.checked)} /></label>
      <section className="settings-account" aria-label="Google account">
        <h3>Google account</h3>
        <p>{session.user.email ?? session.user.displayName ?? 'Signed in with Google'}</p>
        <p className="local-note">Anyone who signs in on this browser can open its local wall.</p>
        {session.logoutError && <p className="settings-account-error" role="alert">{session.logoutError}</p>}
        {confirmSignOut && <p>Sign out of WALLFLOW? Your wall will stay in this browser.</p>}
        <div className="settings-account-actions">
          <button type="button" className="text-button" aria-expanded={confirmSignOut} disabled={session.signingOut}
            onClick={() => setConfirmSignOut(!confirmSignOut)}>{confirmSignOut ? 'Cancel' : <><LogOut size={16} /> Sign out</>}</button>
          {confirmSignOut && <button type="button" className="text-button" disabled={session.signingOut} onClick={onSignOut}>
            <LogOut size={16} /> {session.signingOut ? 'Signing out…' : 'Confirm sign-out'}
          </button>}
        </div>
      </section>
      <button type="submit" className="primary-button settings-save"><Check size={16} /> Done</button>
    </form>
  </Modal>
}
