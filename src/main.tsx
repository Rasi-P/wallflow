import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './styles/auth.css'
import './styles/mobile.css'
import { rememberCaptureLink } from './pwa/captureLink'
import { PwaUpdates } from './pwa/PwaControls'
import SupabaseGate from './app/SupabaseGate.tsx'

rememberCaptureLink()
try {
  const theme = localStorage.getItem('wallflow:mobile-theme')
  if (theme === 'dark' || theme === 'light') document.documentElement.dataset.mobileTheme = theme
} catch { /* Use the system theme when storage is unavailable. */ }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SupabaseGate />
    <PwaUpdates />
  </StrictMode>,
)
