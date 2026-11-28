import type { CaptureOperation, CaptureStorage } from './quickCapture.ts'
import type { LinkedDocument, SavedWorkspace, WorkspaceCommand } from '../types/workspace.ts'

export interface OutboxEntry {
  base: LinkedDocument
  draft?: SavedWorkspace
  operation?: WorkspaceCommand
  conflict?: LinkedDocument
}

export interface WorkspaceOutbox {
  load(): Promise<OutboxEntry | undefined>
  save(entry: OutboxEntry): Promise<void>
}

export function workspaceOutboxKey(project: string, account: string) {
  return JSON.stringify([new URL(project).origin, account])
}

async function openOutbox(storage: IDBFactory | undefined, name: string, store: string) {
  if (!storage) throw new Error('Browser storage is unavailable.')
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = storage.open(name, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(store)
    request.onerror = () => reject(request.error)
    request.onblocked = () => {
      request.onsuccess = () => request.result.close()
      reject(new Error('Browser storage is blocked.'))
    }
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

export function createWorkspaceOutbox(key: string, storage: IDBFactory | undefined = globalThis.indexedDB): WorkspaceOutbox {
  return {
    async load() {
      const db = await openOutbox(storage, 'wallflow-supabase-workspaces', 'outbox')
      try {
        return await new Promise<OutboxEntry | undefined>((resolve, reject) => {
          const request = db.transaction('outbox').objectStore('outbox').get(key)
          request.onsuccess = () => resolve(request.result as OutboxEntry | undefined)
          request.onerror = () => reject(request.error)
        })
      } finally { db.close() }
    },
    async save(entry) {
      const db = await openOutbox(storage, 'wallflow-supabase-workspaces', 'outbox')
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('outbox', 'readwrite', { durability: 'strict' })
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error ?? new Error('Browser storage could not save changes.'))
          transaction.objectStore('outbox').put(entry, key)
        })
      } finally { db.close() }
    },
  }
}

export function createCaptureStorage(scope: string, storage = globalThis.indexedDB): CaptureStorage {
  async function access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openOutbox(storage, 'wallflow-supabase-captures', 'captures')
    try {
      return await new Promise<T>((resolve, reject) => {
        const transaction = db.transaction('captures', mode, { durability: 'strict' })
        transaction.onabort = () => reject(transaction.error ?? new Error('Capture storage is unavailable.'))
        const request = action(transaction.objectStore('captures'))
        transaction.oncomplete = () => resolve(request.result)
      })
    } finally { db.close() }
  }

  return {
    list: () => access('readonly', (store) => store.getAll(IDBKeyRange.bound([scope], [scope, []]))) as Promise<CaptureOperation[]>,
    async save(operation) { await access('readwrite', (store) => store.put(operation, [scope, operation.id])) },
    async remove(id) { await access('readwrite', (store) => store.delete([scope, id])) },
  }
}
