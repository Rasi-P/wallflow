import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './styles/auth.css'
import SupabaseGate from './app/SupabaseGate.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SupabaseGate />
  </StrictMode>,
)
