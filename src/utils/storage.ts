export const storageHealth = { available: true }

export function setStorageAvailable(available: boolean) {
  if (available === storageHealth.available) return
  storageHealth.available = available
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(available ? 'wallflow-storage-restored' : 'wallflow-storage-error'))
}

export const browserStorage: Pick<Storage, 'getItem' | 'setItem'> = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => localStorage.setItem(key, value),
}
