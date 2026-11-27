import { lazy, StrictMode, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import './styles/auth.css'
import { AuthGate } from './app/AuthGate.tsx'
import { AuthLoading } from './auth/SignIn.tsx'

const useSupabasePreview = import.meta.env.MODE === 'supabase-preview'
  && import.meta.env.VITE_WALLFLOW_SUPABASE_PREVIEW === 'true'
const Gate = useSupabasePreview ? lazy(() => import('./app/SupabasePreview.tsx')) : AuthGate

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<AuthLoading />}>
      <Gate />
    </Suspense>
  </StrictMode>,
)
