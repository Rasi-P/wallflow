import { WorkspaceCommandError } from '../auth/supabaseWorkspaceCommands.ts'
import type { LinkedDocument, SavedWorkspace, WorkspaceTransport } from '../types/workspace.ts'
import type { OutboxEntry, WorkspaceOutbox } from '../utils/supabaseOutbox.ts'
import { mergeWorkspace, sameWorkspaceValue } from '../utils/workspaceMerge.ts'
import type { LinkedStatus } from './linkedBoard.ts'

interface SyncOptions {
  api: WorkspaceTransport
  outbox: WorkspaceOutbox
  online: () => boolean
  onWorkspace: (workspace: SavedWorkspace) => void
  onStatus: (status: LinkedStatus, durable: boolean, message?: string) => void
  onSessionInvalid: () => void
  onSources?: (claimed: string[]) => void
  makeId?: () => string
}

export function createWorkspaceSync(options: SyncOptions) {
  let entry: OutboxEntry | undefined
  let busy = false
  let closed = false
  let storing: Promise<boolean> = Promise.resolve(true)
  let active: Promise<void> | undefined
  let trailing = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let durable = false
  let storageError = false
  let outboxRead = false
  let writeNumber = 0

  const isDirty = () => Boolean(entry?.draft || entry?.operation)
  const publish = (status: LinkedStatus, message?: string) => {
    if (!closed) options.onStatus(status, durable, message)
  }
  const offline = () => !options.online()

  function persist() {
    if (!entry) return storing
    if (!outboxRead) {
      storageError = true
      durable = false
      publish('unsaved', 'Browser drafts could not be read. Download any new edits and reload to recover saved drafts.')
      return Promise.resolve(false)
    }
    const snapshot = structuredClone(entry)
    const ticket = ++writeNumber
    durable = false
    storing = storing.then(async () => {
      try {
        await options.outbox.save(snapshot)
        if (ticket === writeNumber) {
          durable = true
          storageError = false
          if (entry?.conflict) publishConflict()
          else if (offline()) publish('offline')
          else publish(isDirty() ? 'saving' : 'saved')
        }
        return true
      } catch {
        storageError = true
        publish('unsaved', 'Browser storage could not save the draft. Download it before closing this workspace.')
        return false
      }
    })
    return storing
  }

  function publishConflict() {
    publish('conflict', 'Another device changed the same part of this workspace. Choose which version to keep or download your draft.')
  }

  function schedule() {
    clearTimeout(timer)
    if (!closed && !busy && !entry?.conflict) timer = setTimeout(() => void sync(), 350)
  }

  function changed(workspace: SavedWorkspace, editing: boolean) {
    if (!entry || closed) return
    busy = editing
    const draft = entry.operation || !sameWorkspaceValue(workspace, entry.base.workspace) ? workspace : undefined
    if (!sameWorkspaceValue(draft, entry.draft)) {
      entry = { ...entry, draft }
      publish(entry.conflict ? 'conflict' : offline() ? 'offline' : 'saving')
      void persist()
    }
    schedule()
  }

  function accept(server: LinkedDocument) {
    if (!entry) {
      entry = { base: server }
    } else if (entry.draft) {
      const merged = mergeWorkspace(entry.base.workspace, entry.draft, server.workspace)
      if (merged.conflicts.length) {
        entry = { ...entry, conflict: server }
        void persist()
        publishConflict()
        return
      }
      entry = { base: server, draft: sameWorkspaceValue(merged.workspace, server.workspace) ? undefined : merged.workspace }
    } else {
      entry = { base: server }
    }
    const visible = entry.draft ?? server.workspace
    void persist()
    options.onWorkspace(visible)
    options.onSources?.(server.claimedSources)
  }

  function failure(error: unknown) {
    if (closed) return
    if (error instanceof WorkspaceCommandError && error.reason === 'auth') {
      options.onSessionInvalid()
      publish('offline', 'Sign in with this account to continue syncing.')
    } else if (error instanceof WorkspaceCommandError && error.reason === 'rejected') {
      publish(entry ? 'unsaved' : 'unavailable', error.message)
    } else {
      publish(entry ? 'offline' : 'unavailable', 'Couldn’t reach account sync. Changes will retry when the connection returns.')
    }
  }

  async function run() {
    if (closed) return
    if (entry?.conflict) { publishConflict(); return }
    if (offline()) {
      if (!storageError) publish(entry ? 'offline' : 'unavailable', entry ? undefined : 'Reconnect to download this workspace to the device.')
      return
    }
    if (busy) return
    if (entry?.draft || entry?.operation) {
      if (!entry.operation) entry = { ...entry, operation: {
        id: options.makeId?.() ?? globalThis.crypto.randomUUID(), base: entry.base, workspace: entry.draft!,
      } }
      const operation = entry.operation!
      if (!await persist() || closed || offline()) return
      let result: LinkedDocument
      try {
        result = await options.api.commit(operation)
      } catch (error) {
        if (!closed && error instanceof WorkspaceCommandError && error.reason === 'rejected') {
          entry = { ...entry, operation: undefined }
          await persist()
        }
        if (!(error instanceof WorkspaceCommandError) || error.reason !== 'conflict') throw error
        if (closed) return
        entry = { ...entry, operation: undefined }
        const remote = await options.api.read()
        if (closed || !remote) return
        if (busy) { void persist(); return }
        accept(remote)
        if (isDirty() && !entry.conflict) schedule()
        return
      }
      if (closed) return
      // The same receipt can return a newer head if the original reply was lost.
      // Local edits made since sending are rebased from the acknowledged payload.
      const draft = entry.draft
      entry = {
        base: { ...operation.base, revision: String(BigInt(operation.base.revision) + 1n), workspace: operation.workspace },
        draft: sameWorkspaceValue(draft, operation.workspace) ? undefined : draft,
      }
      if (busy) {
        void persist()
        return
      }
      accept(result)
      if (isDirty() && !entry.conflict) schedule()
      return
    }
    const result = await options.api.read(entry?.base.revision)
    if (closed || busy) return
    if (result) {
      accept(result)
      if (isDirty() && !entry?.conflict) schedule()
    } else if (entry && storageError) {
      await persist()
    } else {
      publish(entry ? 'saved' : 'unavailable', entry ? undefined : 'The account workspace is unavailable.')
    }
  }

  function sync(): Promise<void> {
    if (active) {
      trailing = true
      return active
    }
    active = run().catch(failure).finally(() => {
      active = undefined
      if (trailing) {
        trailing = false
        schedule()
      }
    })
    return active
  }

  return {
    async start() {
      try {
        const stored = await options.outbox.load()
        if (closed) return
        outboxRead = true
        if (stored) {
          entry = stored
          durable = true
          options.onWorkspace(stored.draft ?? stored.base.workspace)
          options.onSources?.(stored.base.claimedSources)
        }
      } catch {
        storageError = true
      }
      await sync()
    },
    changed, sync,
    snapshot: () => entry,
    async close() {
      closed = true
      clearTimeout(timer)
      await storing
    },
    async persistDraft() {
      if (!isDirty()) return true
      return persist()
    },
    async resolve(keepLocal: boolean) {
      if (!entry?.conflict || !entry.draft || busy || active) return
      const remote = entry.conflict
      const retained = keepLocal ? mergeWorkspace(entry.base.workspace, entry.draft, remote.workspace).workspace : remote.workspace
      entry = { base: remote, draft: sameWorkspaceValue(retained, remote.workspace) ? undefined : retained }
      options.onWorkspace(retained)
      options.onSources?.(remote.claimedSources)
      await persist()
      schedule()
    },
    async importWhenSaved(action: (base: LinkedDocument) => Promise<LinkedDocument>) {
      if (!entry || closed || active || busy || !outboxRead || storageError || offline() || isDirty() || entry.conflict) {
        throw new Error('Wait for the account workspace to sync before importing.')
      }
      active = (async () => {
        const result = await action(entry!.base)
        if (!closed) accept(result)
      })()
      try { await active }
      finally { active = undefined; schedule() }
    },
    async restore(saved: SavedWorkspace, reviewedRevision: string) {
      if (!entry || closed || active || busy || offline() || !outboxRead || storageError || isDirty() || entry.conflict) {
        throw new Error('Finish editing and sync pending changes before restoring a backup.')
      }
      const previous = entry
      const changedSinceReview = 'The account workspace changed. Export the latest version and review the backup again.'
      if (previous.base.revision !== reviewedRevision) throw new Error(changedSinceReview)
      active = (async () => {
        const remote = await options.api.read(reviewedRevision)
        if (closed || entry !== previous || busy || offline()) throw new Error(changedSinceReview)
        if (remote) {
          accept(remote)
          throw new Error(changedSinceReview)
        }
        const replacement: OutboxEntry = {
          base: previous.base, draft: sameWorkspaceValue(saved, previous.base.workspace) ? undefined : saved,
        }
        entry = replacement
        if (!await persist()) {
          if (entry === replacement) entry = previous
          throw new Error('The restore could not be saved on this device. Keep the backup file.')
        }
        if (!closed && entry === replacement) options.onWorkspace(saved)
      })()
      try { await active }
      finally {
        active = undefined
        schedule()
      }
    },
  }
}
