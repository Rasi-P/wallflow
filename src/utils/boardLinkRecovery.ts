// The link confirmation can outlive the browser process. Use a strict commit
// for its recovery marker so reopening the browser can still hide the source.
const DATABASE = 'wallflow-board-link-recovery'
const STORE = 'protected-sources'

export type PendingSource = {
  sourceId: string
  phase: 'pending'
  accountId: string
}

type RecoveryEntry = PendingSource & { boardId: string }

function openRecoveryStore() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'boardId' })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      request.onsuccess = () => request.result.close()
      reject(new Error('The browser recovery store is blocked.'))
    }
  })
}

export async function readRecoveryEntries() {
  if (typeof indexedDB === 'undefined') return []
  const db = await openRecoveryStore()
  try {
    return await new Promise<RecoveryEntry[]>((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally { db.close() }
}

async function writeRecoveryEntry(write: (store: IDBObjectStore) => void) {
  if (typeof indexedDB === 'undefined') throw new Error('Connecting a board requires durable browser storage.')
  const db = await openRecoveryStore()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite', { durability: 'strict' })
      if (transaction.durability !== 'strict') {
        transaction.abort()
        throw new Error('Connecting a board requires durable browser storage.')
      }
      transaction.oncomplete = () => resolve()
      transaction.onabort = () => reject(transaction.error ?? new Error('The browser could not save the recovery marker.'))
      write(transaction.objectStore(STORE))
    })
  } finally { db.close() }
}

export function saveRecoveryEntry(boardId: string, source: PendingSource) {
  return writeRecoveryEntry((store) => { store.put({ boardId, ...source }) })
}

export function removeRecoveryEntry(boardId: string) {
  return writeRecoveryEntry((store) => { store.delete(boardId) })
}
