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

export function createWorkspaceOutbox(key: string, storage: IDBFactory | undefined = globalThis.indexedDB): WorkspaceOutbox {
  async function open() {
    if (!storage) throw new Error('Browser storage is unavailable.')
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = storage.open('wallflow-supabase-workspaces', 1)
      request.onupgradeneeded = () => request.result.createObjectStore('outbox')
      request.onerror = () => reject(request.error)
      request.onblocked = () => {
        request.onsuccess = () => request.result.close()
        reject(new Error('Browser storage is blocked.'))
      }
      request.onsuccess = () => resolve(request.result)
    })
  }

  return {
    async load() {
      const db = await open()
      try {
        return await new Promise<OutboxEntry | undefined>((resolve, reject) => {
          const request = db.transaction('outbox').objectStore('outbox').get(key)
          request.onsuccess = () => resolve(request.result as OutboxEntry | undefined)
          request.onerror = () => reject(request.error)
        })
      } finally { db.close() }
    },
    async save(entry) {
      const db = await open()
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
