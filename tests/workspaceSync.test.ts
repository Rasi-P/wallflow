import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceCommandError } from '../src/auth/supabaseWorkspaceCommands.ts'
import type { WorkspaceCommand } from '../src/auth/supabaseWorkspaceCommands.ts'
import type { LinkedDocument } from '../src/auth/linkedWallApi.ts'
import { createWorkspaceSync } from '../src/stores/workspaceSync.ts'
import { mergeWorkspace } from '../src/utils/workspaceMerge.ts'
import type { SavedWorkspace } from '../src/types/workspace.ts'
import { workspaceOutboxKey } from '../src/utils/supabaseOutbox.ts'
import type { OutboxEntry, WorkspaceOutbox } from '../src/utils/supabaseOutbox.ts'

const initial: SavedWorkspace = {
  version: 2, activeBoardId: 'board', boardOrder: ['board'],
  boards: {
    board: {
      id: 'board', name: 'Board',
      document: { wallRotation: [0, 0], sections: [], notes: [
        { id: 'a', title: 'A', body: '', position: [0, 0], rotation: 0, color: 'pink' },
        { id: 'b', title: 'B', body: '', position: [2, 0], rotation: 0, color: 'yellow' },
      ] },
      preferences: { showHints: true, onboardingComplete: true, noteDefaults: { color: 'yellow', typography: 'sans', size: 'standard', rotation: 'straight' } },
      presentation: { lighting: 'warm', appearance: { theme: 'office', shade: 'theme', intensity: 100, ambience: 'theme' } },
      notifiedReminders: [],
    },
  },
}
const titles = (value: SavedWorkspace) => value.boards.board.document.notes.map((note) => note.title)
function edit(document: SavedWorkspace, index: number, title: string) {
  const result = structuredClone(document)
  result.boards.board.document.notes[index].title = title
  return result
}
const head = (workspace = initial, revision = '0'): LinkedDocument => ({ revision, workspace, claimedSources: [] })

function sandbox(outbox?: WorkspaceOutbox) {
  let stored: OutboxEntry | undefined
  let server = head()
  let online = true
  let lostReply = false
  let number = 0
  const receipts = new Set<string>()
  const sent: WorkspaceCommand[] = []
  const statuses: string[] = []
  const visible: SavedWorkspace[] = []
  const disk = outbox ?? {
    async load() { return stored && structuredClone(stored) },
    async save(entry: OutboxEntry) { stored = structuredClone(entry) },
  }
  const api = {
    async read(revision?: string | null) { return revision === server.revision ? undefined : server },
    async commit(command: WorkspaceCommand) {
      sent.push(command)
      if (receipts.has(command.id)) return server
      if (server.revision !== command.base.revision) throw new WorkspaceCommandError('conflict', 'Stale revision')
      server = head(command.workspace, String(BigInt(server.revision) + 1n))
      receipts.add(command.id)
      if (lostReply) { lostReply = false; throw new WorkspaceCommandError('network', 'Reply lost') }
      return server
    },
  }
  return {
    create: () => createWorkspaceSync({
      api, outbox: disk, online: () => online, onWorkspace: (ws) => visible.push(ws),
      onStatus: (status) => statuses.push(status), onSessionInvalid() {}, makeId: () => String(++number),
    }),
    sent, statuses, visible,
    getServer: () => server,
    getStored: () => stored,
    remote(value: SavedWorkspace) { server = head(value, String(BigInt(server.revision) + 1n)) },
    connectivity(value: boolean) { online = value },
    loseReply() { lostReply = true },
  }
}

test('independent note edits merge and conflicting edits and delete-versus-edit preserve the local variant', () => {
  const local = edit(initial, 0, 'Local')
  const remote = edit(initial, 1, 'Remote')
  assert.deepEqual(titles(mergeWorkspace(initial, local, remote).workspace), ['Local', 'Remote'])
  assert.deepEqual(mergeWorkspace(initial, local, remote).conflicts, [])
  assert.equal(mergeWorkspace(initial, local, edit(initial, 0, 'Other text')).conflicts.length, 1)
  const removed = structuredClone(remote)
  removed.boards.board.document.notes.shift()
  assert.equal(mergeWorkspace(initial, local, removed).conflicts.length, 1)
  assert.deepEqual(titles(mergeWorkspace(initial, local, removed).workspace), ['Local', 'Remote'])
})

test('an edit is durable before it finishes and resumes after reload and reconnect', async () => {
  const runtime = sandbox()
  let sync = runtime.create()
  await sync.start()
  runtime.connectivity(false)
  sync.changed(edit(initial, 0, 'Offline text'), true)
  assert.equal(await sync.persistDraft(), true)
  await sync.close()
  assert.equal(runtime.sent.length, 0)
  sync = runtime.create()
  await sync.start()
  assert.deepEqual(titles(runtime.visible.at(-1)!), ['Offline text', 'B'])
  assert.equal(runtime.statuses.at(-1), 'offline')
  runtime.connectivity(true)
  await sync.sync()
  assert.deepEqual(titles(runtime.getServer().workspace), ['Offline text', 'B'])
  assert.equal(runtime.sent.length, 1)
  await sync.close()
})

test('losing a committed reply retries the same persisted operation ID after refresh', async () => {
  const runtime = sandbox()
  let sync = runtime.create()
  await sync.start()
  runtime.loseReply()
  sync.changed(edit(initial, 0, 'Commit once'), false)
  await sync.sync()
  await sync.close()
  const operationId = runtime.getStored()!.operation!.id
  assert.equal(runtime.getServer().revision, '1')
  sync = runtime.create()
  await sync.start()
  assert.deepEqual(runtime.sent.map(({ id }) => id), [operationId, operationId])
  assert.equal(runtime.getServer().revision, '1')
  assert.equal(sync.snapshot()?.operation, undefined)
  await sync.close()
})

test('conflict draft survives refresh and keeping it preserves disjoint remote edits', async () => {
  const runtime = sandbox()
  let sync = runtime.create()
  await sync.start()
  sync.changed(edit(initial, 0, 'Keep mine'), false)
  runtime.remote(edit(edit(initial, 0, 'Their text'), 1, 'Their other note'))
  await sync.sync()
  await sync.close()
  assert.equal(runtime.statuses.at(-1), 'conflict')
  sync = runtime.create()
  await sync.start()
  assert.deepEqual(titles(sync.snapshot()!.draft!), ['Keep mine', 'B'])
  await sync.resolve(true)
  await sync.sync()
  assert.deepEqual(titles(runtime.getServer().workspace), ['Keep mine', 'Their other note'])
  await sync.close()
})

test('a storage failure leaves the draft available for export and prevents an unrecorded send', async () => {
  const runtime = sandbox({
    async load() { return undefined },
    async save() { throw new Error('Quota exceeded') },
  })
  const sync = runtime.create()
  await sync.start()
  sync.changed(edit(initial, 0, 'Volatile text'), false)
  await sync.sync()
  assert.equal(runtime.sent.length, 0)
  assert.equal(runtime.statuses.at(-1), 'unsaved')
  assert.deepEqual(titles(sync.snapshot()!.draft!), ['Volatile text', 'B'])
  await sync.close()
})

test('a failed outbox read cannot overwrite or replay the unread draft', async () => {
  let disk: OutboxEntry = { base: head(), draft: edit(initial, 0, 'Previously saved') }
  const runtime = sandbox({
    async load() { throw new Error('Temporarily unavailable') },
    async save(entry) { disk = entry },
  })
  const sync = runtime.create()
  await sync.start()
  await assert.rejects(sync.importWhenSaved(async () => assert.fail('An unread outbox must block imports.')), /before importing/)
  sync.changed(edit(initial, 0, 'New volatile text'), false)
  assert.equal(await sync.persistDraft(), false)
  await sync.sync()
  assert.equal(runtime.statuses.at(-1), 'unsaved')
  assert.equal(runtime.sent.length, 0)
  assert.deepEqual(titles(disk.draft!), ['Previously saved', 'B'])
  assert.deepEqual(titles(sync.snapshot()!.draft!), ['New volatile text', 'B'])
  await sync.close()
})

test('account and project have distinct outbox namespaces', () => {
  const a = workspaceOutboxKey('http://localhost:55321/', 'first')
  assert.equal(a, workspaceOutboxKey('http://localhost:55321', 'first'))
  assert.notEqual(a, workspaceOutboxKey('http://localhost:55321', 'second'))
  assert.notEqual(a, workspaceOutboxKey('http://localhost:55322', 'first'))
})

test('closing a workspace during a durable backup restore prevents stale publication', async () => {
  const commitStarted = Promise.withResolvers<void>()
  const commitFinished = Promise.withResolvers<void>()
  const runtime = sandbox({
    async load() { return undefined },
    async save(entry) {
      if (entry.draft) {
        commitStarted.resolve()
        await commitFinished.promise
      }
    },
  })
  const sync = runtime.create()
  await sync.start()
  const restoration = sync.restore(edit(initial, 0, 'Recovery after switching'))
  await commitStarted.promise
  const closed = sync.close()
  commitFinished.resolve()
  await Promise.all([restoration, closed])
  assert.deepEqual(runtime.visible.map(titles), [['A', 'B']])
  assert.equal(runtime.sent.length, 0)
})
