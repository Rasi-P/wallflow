import { Download, RefreshCw } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Modal } from '../components/ui/Modal'
import { persistAccountDraft } from '../stores/linkedBoard'
import { installState, requestInstall, subscribeInstall } from './install'

export function InstallWallflow() {
  const state = useSyncExternalStore(subscribeInstall, installState)
  const [guidance, setGuidance] = useState(false)
  if (state === 'installed') return null
  return <>
    <button type="button" className="text-button pwa-install" aria-expanded={guidance}
      onClick={() => {
        if (state === 'prompt') void requestInstall().catch(() => setGuidance(true))
        else setGuidance(!guidance)
      }}><Download size={16} /> Install WALLFLOW</button>
    {guidance && <Modal title="Install WALLFLOW" onClose={() => setGuidance(false)} className="pwa-install-modal">
      <div>
        <p><strong>iPhone and iPad</strong> Open WALLFLOW in Safari, tap Share, then Add to Home Screen.</p>
        <p><strong>Android</strong> Open the browser menu and choose Install app or Add to Home screen.</p>
        <p><strong>Desktop</strong> Use the install icon in the address bar or the browser’s app menu when available.</p>
      </div>
    </Modal>}
  </>
}

export function PwaUpdates() {
  const [worker, setWorker] = useState<ServiceWorker>()
  const [dismissed, setDismissed] = useState<ServiceWorker>()
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!import.meta.env.PROD || !isSecureContext || !('serviceWorker' in navigator)
      || location.pathname.startsWith('/auth/')) return
    let closed = false
    let registration: ServiceWorkerRegistration | undefined
    let observed: ServiceWorker | null = null
    let checked = 0
    function checkWaiting() {
      if (!closed && navigator.serviceWorker.controller && registration?.waiting) setWorker(registration.waiting)
    }
    function observe() {
      observed?.removeEventListener('statechange', checkWaiting)
      observed = registration?.installing ?? null
      observed?.addEventListener('statechange', checkWaiting)
      checkWaiting()
    }
    function checkRelease() {
      if (!registration || document.visibilityState !== 'visible' || Date.now() - checked < 60_000) return
      checked = Date.now()
      void registration.update().catch(() => {})
    }
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((result) => {
      if (closed) return
      registration = result
      registration.addEventListener('updatefound', observe)
      observe()
      checkRelease()
    }).catch(() => {})
    document.addEventListener('visibilitychange', checkRelease)
    window.addEventListener('online', checkRelease)
    const timer = window.setInterval(checkRelease, 5 * 60_000)
    return () => {
      closed = true
      clearInterval(timer)
      registration?.removeEventListener('updatefound', observe)
      observed?.removeEventListener('statechange', checkWaiting)
      document.removeEventListener('visibilitychange', checkRelease)
      window.removeEventListener('online', checkRelease)
    }
  }, [])

  async function apply() {
    if (!worker) return
    setStatus('Saving your draft…')
    if (!await persistAccountDraft()) {
      setStatus('Save or export your draft before refreshing.')
      return
    }
    if (worker.state === 'activated') { location.reload(); return }
    const reload = () => {
      clearTimeout(timeout)
      location.reload()
    }
    const timeout = window.setTimeout(() => {
      navigator.serviceWorker.removeEventListener('controllerchange', reload)
      setStatus('The update is still waiting. Try again in a moment.')
    }, 12_000)
    navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
    setStatus('Refreshing WALLFLOW…')
    worker.postMessage({ type: 'WALLFLOW_ACTIVATE_UPDATE' })
  }

  if (!worker || worker === dismissed) return null
  return <aside className="pwa-update" aria-label="Application update">
    <RefreshCw size={17} aria-hidden="true" />
    <span role="status">{status || 'A WALLFLOW update is ready.'}</span>
    <button type="button" onClick={() => void apply()}>Refresh</button>
    <button type="button" onClick={() => setDismissed(worker)}>Later</button>
  </aside>
}
