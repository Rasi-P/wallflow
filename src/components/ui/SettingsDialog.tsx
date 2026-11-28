import { useState } from 'react'
import { Check, Compass, LogOut } from 'lucide-react'
import type { Account } from '../../types/auth'
import { useWallStore } from '../../stores/wallStore'
import { Modal } from './Modal'
import { AppearanceSettings } from './AppearanceSettings'
import { InstallWallflow } from '../../pwa/PwaControls'
import { useLinkedBoard } from '../../stores/linkedBoard'

export function SettingsDialog({ account, onSignIn, onSignOut, mobile }: {
  mobile?: boolean
  account?: Account
  onSignIn?: () => void
  onSignOut?: () => void
}) {
  const syncStatus = useLinkedBoard((s) => s.status)
  const linked = useLinkedBoard((s) => s.linked)
  const unsavedAccountChanges = ['saving', 'unsaved', 'conflict', 'offline'].includes(syncStatus)
  const wallName = useWallStore((s) => s.wallName)
  const showHints = useWallStore((s) => s.showHints)
  const [name, setName] = useState(wallName)
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const close = () => useWallStore.getState().setPanel('settingsOpen', false)
  return <Modal title={mobile ? "Workspace settings" : "Wall settings"} onClose={close} className="settings-modal">
    <form className="settings-form" onSubmit={(e) => { e.preventDefault(); useWallStore.getState().setWallName(name); close() }}>
      <div className="settings-content">
        <label className="field-label" htmlFor="wall-name">Wall name</label><input id="wall-name" className="text-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={48} />
        <AppearanceSettings />
        {mobile && <label className="mobile-theme-field">Theme <select aria-label="Mobile theme" defaultValue={document.documentElement.dataset.mobileTheme ?? 'system'} onChange={(event) => {
          const value = event.target.value
          document.documentElement.dataset.mobileTheme = value
          try { localStorage.setItem('wallflow:mobile-theme', value) } catch { /* Keep the theme for this view. */ }
        }}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>}
        <label className="toggle-label"><strong>Show movement hints</strong><input type="checkbox" role="switch" checked={showHints} onChange={(e) => useWallStore.getState().setShowHints(e.target.checked)} /></label>
        <button type="button" className="text-button settings-walkthrough" onClick={() => {
          const { setWallName, startTutorial } = useWallStore.getState()
          setWallName(name)
          startTutorial()
        }}><Compass size={16} /> Start walkthrough</button>
        <InstallWallflow />
        {account && <section className="settings-account" aria-label="Google account">
          <h3>Google account</h3>
          <p>{account.email ?? account.displayName ?? 'Signed in with Google'}</p>
          <p className="local-note">{linked ? 'This board is saved to your account.' : 'Browser-only boards can be imported after sign-in.'}</p>
          {confirmSignOut && <p>{unsavedAccountChanges
            ? 'Sign out of WALLFLOW? Drafts saved on this device will be available when you sign back into this account.'
            : 'Sign out of WALLFLOW? Your saved boards will still be available.'}</p>}
          <div className="settings-account-actions">
            <button type="button" className="text-button" aria-expanded={confirmSignOut}
              onClick={() => setConfirmSignOut(!confirmSignOut)}>{confirmSignOut ? 'Cancel' : <><LogOut size={16} /> Sign out</>}</button>
            {confirmSignOut && <button type="button" className="text-button" onClick={onSignOut}>
              <LogOut size={16} /> Confirm sign-out
            </button>}
          </div>
        </section>}
        {!account && onSignIn && <section className="settings-account" aria-label="Google account">
          <h3>Google account</h3>
          <button type="button" className="text-button" onClick={onSignIn}>Sign in to open your account workspace</button>
        </section>}
      </div>
      <div className="settings-footer"><button type="submit" className="primary-button settings-save"><Check size={16} /> Done</button></div>
    </form>
  </Modal>
}
