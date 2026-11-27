import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account } from '../auth/api.ts'
import { createSupabaseWorkspaceCommands } from '../auth/supabaseWorkspaceCommands.ts'
import type { SavedWorkspace } from '../types/workspace.ts'
import { BOARD_LINK_PREFIX } from '../utils/boardLinkStorage'
import { createWorkspaceOutbox, workspaceOutboxKey } from '../utils/supabaseOutbox'
import { downloadSnapshot, mountAccountBoard } from './linkedBoard'
import { createSupabaseBrowserImports } from './supabaseBrowserImports'
import { workspace } from './wallStore'
import { createWorkspaceSync } from './workspaceSync'
import { readWorkspace, WORKSPACE_STORAGE_KEY } from './workspaceStorage'

export function mountSupabaseLinkedBoard(client: SupabaseClient, project: string, account: Account, verifySession: () => void) {
  return mountAccountBoard(account, (update) => {
    const lifetime = new AbortController()
    const key = workspaceOutboxKey(project, account.id)
    const api = createSupabaseWorkspaceCommands(client, account.id, lifetime.signal)
    const stopped = () => lifetime.signal.aborted
    let attached = false
    let started = false
    let releaseLease: () => void
    const lease = new Promise<void>((resolve) => { releaseLease = resolve })
    const imports = createSupabaseBrowserImports(api, `supabase:${key}`, stopped, update)
    const sync = createWorkspaceSync({
      api, outbox: createWorkspaceOutbox(key), online: () => navigator.onLine !== false,
      onSessionInvalid: verifySession,
      onStatus: (status, durable, message) => update({ status, durable, message, linked: attached }),
      onSources: imports.setClaimed,
      onWorkspace(saved) {
        if (stopped()) return
        if (attached) workspace.updateCloudWorkspace(saved)
        else {
          attached = true
          workspace.setCloudWorkspace(saved, sync.changed)
          update({ linked: true })
        }
      },
    })
    let channel: ReturnType<SupabaseClient['channel']> | undefined
    let largestRevision = -1n
    const refresh = () => {
      if (stopped() || !started) return
      void sync.sync()
      if (attached && navigator.onLine !== false) void imports.recover().catch(() => {})
    }
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    const onStorage = (event: StorageEvent) => {
      if (event.key === WORKSPACE_STORAGE_KEY && attached) workspace.reload()
      if (event.key?.startsWith(BOARD_LINK_PREFIX) || event.key === WORKSPACE_STORAGE_KEY) refresh()
    }
    window.addEventListener('focus', onVisible)
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    const interval = window.setInterval(onVisible, 15_000)

    function beginRealtime() {
      channel = client.channel(`wallflow-workspace:${account.id}`, { config: { private: true } })
        .on('broadcast', { event: 'workspace_revision' }, ({ payload }) => {
          const revision: unknown = payload?.revision
          if (typeof revision !== 'string' || !/^\d{1,19}$/.test(revision) || BigInt(revision) <= largestRevision) return
          largestRevision = BigInt(revision)
          refresh()
        })
        .subscribe((status) => { if (status === 'SUBSCRIBED') refresh() })
    }

    const waiting = window.setTimeout(() => {
      if (!attached && !stopped()) update({ status: 'unavailable', message: 'Waiting for this account’s workspace. Close another editing tab if one is open.' })
    }, 2_000)
    if (!navigator.locks) {
      clearTimeout(waiting)
      update({ status: 'unavailable', message: 'Open the account workspace in a secure browser that supports tab locks.' })
    } else {
      void navigator.locks.request(`wallflow-workspace:${key}`, { signal: lifetime.signal }, async () => {
        if (stopped()) return
        clearTimeout(waiting)
        started = true
        await sync.start()
        if (!stopped()) {
          beginRealtime()
          refresh()
        }
        await lease
      }).catch(() => {
        if (!stopped()) update({ status: 'unavailable', message: 'The browser could not open the account workspace.' })
      })
    }

    function exportWorkspace() {
      const entry = sync.snapshot()
      if (entry) downloadSnapshot({ format: 'wallflow-supabase-workspace', accountId: account.id, project: new URL(project).origin,
        workspace: entry.draft ?? entry.base.workspace }, 'wallflow-account-workspace.json')
    }

    return {
      close() {
        lifetime.abort()
        clearInterval(interval)
        clearTimeout(waiting)
        window.removeEventListener('focus', onVisible)
        window.removeEventListener('online', refresh)
        window.removeEventListener('offline', refresh)
        window.removeEventListener('storage', onStorage)
        document.removeEventListener('visibilitychange', onVisible)
        if (channel) void client.removeChannel(channel)
        void sync.close().finally(releaseLease!)
        workspace.clearLinkedBoard()
      },
      retry: async () => { if (started) await sync.sync(); if (attached) void imports.recover().catch(() => {}) },
      reloadSaved: () => sync.resolve(false),
      keepDraft: () => { void sync.resolve(true) },
      download: exportWorkspace,
      exportWorkspace,
      downloadRecovery: imports.download,
      persistDraft: sync.persistDraft,
      importBoards: (boards) => sync.importWhenSaved((base) => imports.confirm(base, boards)),
      async restoreWorkspace(raw: string) {
        const restore = JSON.parse(raw) as { format?: string; accountId?: string; project?: string; workspace?: SavedWorkspace }
        if (restore?.format !== 'wallflow-supabase-workspace' || restore.accountId !== account.id
          || restore.project !== new URL(project).origin || restore.workspace?.version !== 2
          || !readWorkspace(JSON.stringify(restore.workspace))) {
          throw new Error('Select a workspace backup from this account and development project.')
        }
        await sync.restore(restore.workspace)
      },
    }
  }, true)
}
