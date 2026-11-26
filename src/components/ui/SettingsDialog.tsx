import { useState } from 'react'
import { Check, Compass, LogOut } from 'lucide-react'
import type { ActiveSession } from '../../auth/session'
import { useWallStore } from '../../stores/wallStore'
import { Modal } from './Modal'
import { AppearanceSettings } from './AppearanceSettings'

export function SettingsDialog({ session, onSignOut }: { session: ActiveSession; onSignOut: () => void }) {
  const wallName = useWallStore((s) => s.wallName)
  const showHints = useWallStore((s) => s.showHints)
  const [name, setName] = useState(wallName)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const close = () => useWallStore.getState().setPanel('settingsOpen', false)
  return <Modal title="Wall settings" onClose={close} className="settings-modal">
    <form className="settings-form" onSubmit={(e) => { e.preventDefault(); useWallStore.getState().setWallName(name); close() }}>
      <div className="settings-content">
        <label className="field-label" htmlFor="wall-name">Wall name</label><input id="wall-name" className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
        <AppearanceSettings />
        <label className="toggle-label"><strong>Show movement hints</strong><input type="checkbox" role="switch" checked={showHints} onChange={(e) => useWallStore.getState().setShowHints(e.target.checked)} /></label>
        <button type="button" className="text-button settings-walkthrough" onClick={() => {
          const { setWallName, startTutorial } = useWallStore.getState()
          setWallName(name)
          startTutorial()
        }}><Compass size={16} /> Start walkthrough</button>
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
      </div>
      <div className="settings-footer"><button type="submit" className="primary-button settings-save"><Check size={16} /> Done</button></div>
    </form>
  </Modal>
}
