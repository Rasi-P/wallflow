import { ArrowRight, CircleAlert, RefreshCw } from 'lucide-react'
import type { AuthState } from './session'

type SignInState = Extract<AuthState, { status: 'anonymous' | 'error' }>

export function AuthLoading({ opening = false }: { opening?: boolean }) {
  return <main className="auth-loading">
    <img src="/favicon.svg" alt="" width="38" height="38" />
    <span role="status">{opening ? 'Opening WALLFLOW…' : 'Checking your session…'}</span>
  </main>
}

export function SignIn({ state, onContinue, onRetry, onUseDevice, onExit, exitLabel }: {
  state: SignInState
  onContinue: () => void
  onRetry: () => void
  onUseDevice?: () => void
  onExit?: () => void
  exitLabel?: string
}) {
  const canSignIn = state.status === 'anonymous'
  const starting = canSignIn && state.starting

  return <main className="sign-in" aria-label="WALLFLOW sign-in">
    <div className="sign-in-layout">
      <div className="sign-in-copy">
        <div className="brand"><img src="/favicon.svg" alt="" /><span>WALLFLOW<span className="brand-period">.</span></span></div>
        <h1>Your thoughts.<br />Your space.<br />Your wall.</h1>
        <p className="sign-in-description">A personal 3D workspace for writing and arranging sticky notes.</p>
        {state.notice && <div className="sign-in-notice" role="alert"><CircleAlert size={18} aria-hidden="true" /><span>{state.notice}</span></div>}
        <button type="button" className="sign-in-button" onClick={canSignIn ? onContinue : onRetry} disabled={starting}>
          {canSignIn
            ? <><span>{starting ? 'Opening Google…' : 'Continue with Google'}</span><ArrowRight size={18} aria-hidden="true" /></>
            : <><span>Retry session check</span><RefreshCw size={16} aria-hidden="true" /></>}
        </button>
        {starting && <span className="auth-sr-only" role="status">Opening Google sign-in</span>}
        {onExit && <button type="button" className="text-button" onClick={onExit}>{exitLabel}</button>}
        {onUseDevice && <button type="button" className="text-button" disabled={starting} onClick={onUseDevice}>Use this browser only</button>}
        <p className="sign-in-local">Sign in to open your account workspace on any device.</p>
      </div>
      <div className="sign-in-preview" aria-hidden="true">
        <div className="sign-in-paper sign-in-paper-yellow" />
        <div className="sign-in-paper sign-in-paper-green" />
        <div className="sign-in-paper sign-in-paper-pink" />
      </div>
    </div>
  </main>
}
