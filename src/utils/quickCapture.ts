import { WorkspaceCommandError } from '../auth/supabaseWorkspaceCommands.ts'

export type CaptureInput = { content: string; boardId?: string; checklist?: string[] }
export type CaptureOperation = CaptureInput & { id: string; created: number; error?: string }
export interface CaptureStorage {
  list(): Promise<CaptureOperation[]>
  save(operation: CaptureOperation): Promise<void>
  remove(id: string): Promise<void>
}

export type CaptureState = { entries: CaptureOperation[]; sending?: string; message?: string; error?: string }

export function createQuickCapture({
  storage, send, online, onState, onCaptured, onAuth, canSend,
}: {
  storage: CaptureStorage
  send: (operation: CaptureOperation) => Promise<{ note: unknown }>
  online: () => boolean
  onState: (state: CaptureState) => void
  onCaptured: () => void
  onAuth: () => void
  canSend: (operation: CaptureOperation) => boolean
}) {
  let state: CaptureState = { entries: [] }
  let closed = false
  let active: Promise<void> | undefined
  let trailing = false
  let reading = 0

  function publish(patch: Partial<CaptureState>) {
    if (closed) return
    state = { ...state, ...patch }
    onState(state)
  }

  async function load() {
    const ticket = ++reading
    try {
      const entries = (await storage.list()).sort((a, b) => a.created - b.created)
      if (ticket === reading) publish({ entries, error: undefined })
      return entries
    } catch {
      if (ticket === reading) publish({ error: 'Capture storage could not be read on this device.' })
      return []
    }
  }

  async function drain() {
    const entries = await load()
    for (const entry of entries) {
      if (closed || !online()) break
      if (entry.error || !canSend(entry)) continue
      publish({ sending: entry.id, message: undefined })
      try {
        const receipt = await send(entry)
        await storage.remove(entry.id)
        publish({ message: receipt.note === null ? 'This capture was already saved and later deleted.' : 'Note synced to your workspace.' })
        if (!closed) onCaptured()
      } catch (error) {
        if (closed) break
        if (error instanceof WorkspaceCommandError) {
          if (error.reason === 'auth') {
            publish({ message: 'Sign in again to sync your pending captures.' })
            onAuth()
            break
          }
          if (error.reason === 'network') {
            publish({ message: 'Capture saved on this device. Sync will retry when WALLFLOW reconnects.' })
            break
          }
          await storage.save({ ...entry, error: error.message })
        } else {
          publish({ message: 'Capture remains pending. WALLFLOW will retry with the same request.' })
          break
        }
      } finally {
        publish({ sending: undefined })
        await load()
      }
    }
  }

  function flush(): Promise<void> {
    if (closed) return Promise.resolve()
    if (active) { trailing = true; return active }
    active = drain().catch(() => publish({ message: 'Capture remains pending. Check this device’s storage and retry.' })).finally(() => {
      active = undefined
      if (trailing) { trailing = false; void flush() }
    })
    return active
  }

  return {
    flush,
    close() { closed = true },
    async submit(input: CaptureInput) {
      if (closed) throw new Error('Sign in again to capture a note.')
      const content = input.content.trim()
      const checklist = input.checklist?.map((item) => item.trim()).filter(Boolean)
      if ((!content && !checklist?.length) || content.length > 240 || (checklist?.length ?? 0) > 24
        || checklist?.some((item) => item.length > 120)) throw new Error('Enter up to 240 characters and up to 24 checklist items of 120 characters each.')
      await storage.save({ id: crypto.randomUUID(), created: Date.now(), content, checklist, boardId: input.boardId })
      publish({ message: online() ? 'Capture queued for sync.' : 'Capture saved on this device until you reconnect.' })
      void flush()
    },
    async change(id: string, retry: boolean) {
      if (closed) return
      const entry = (await storage.list()).find((item) => item.id === id)
      if (!entry?.error || closed) return
      if (retry) await storage.save({ ...entry, error: undefined })
      else await storage.remove(id)
      void flush()
    },
  }
}
