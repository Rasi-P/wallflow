// Avoid repeated disk writes for camera movement and other transient UI changes.
let lastSaved: string | null = null
export const storageHealth = { available: true }

function failed() {
  storageHealth.available = false
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('wallflow-storage-error'))
}

export const browserStorage = {
  getItem(key: string): string | null {
    try {
      lastSaved = localStorage.getItem(key)
      return lastSaved
    } catch {
      lastSaved = null
      failed()
      return null
    }
  },
  setItem(key: string, value: string) {
    if (value === lastSaved) return
    try { localStorage.setItem(key, value); lastSaved = value } catch { failed() }
  },
  removeItem(key: string) {
    try { localStorage.removeItem(key); lastSaved = null } catch { failed() }
  },
}
