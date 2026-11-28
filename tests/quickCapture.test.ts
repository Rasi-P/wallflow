import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkspaceCommandError } from '../src/auth/supabaseWorkspaceCommands.ts'
import { createQuickCapture } from '../src/utils/quickCapture.ts'
import type { CaptureOperation, CaptureState } from '../src/utils/quickCapture.ts'

function fixture() {
  const operations = new Map<string, CaptureOperation>()
  const scopes = new Map<string, Map<string, CaptureOperation>>([['project-a/owner-a', operations]])
  const attempts: CaptureOperation[] = []
  let status: CaptureState = { entries: [] }
  let connected = false
  let auth = 0
  let revealed = 0
  let result: () => { note: unknown } = () => ({ note: {} })

  function queue(scope = 'project-a/owner-a') {
    if (!scopes.has(scope)) scopes.set(scope, new Map())
    const available = scopes.get(scope)!
    return createQuickCapture({
      storage: {
        async list() { return structuredClone([...available.values()]) },
        async save(operation) { available.set(operation.id, operation) },
        async remove(id) { available.delete(id) },
      },
      send: async (entry) => {
        assert.ok(available.has(entry.id), 'Record the operation durably before sending it.')
        attempts.push(entry)
        return result()
      },
      online: () => connected, onState: (change) => { status = change },
      onCaptured: () => { revealed++ }, onAuth: () => { auth++ }, canSend: () => true,
    })
  }
  return { queue, operations, attempts, status: () => status, auth: () => auth, revealed: () => revealed,
    online: (value: boolean) => { connected = value }, respond: (value: typeof result) => { result = value } }
}

test('offline capture survives reload and lost responses with the same UUID, board and checklist', async () => {
  const api = fixture()
  const first = api.queue()
  await first.submit({ content: '  A note  ', boardId: 'board-b', checklist: [' an item ', ' '] })
  const [accepted] = api.operations.values()
  assert.match(accepted.id, /^[0-9a-f-]{36}$/)
  assert.deepEqual(accepted.checklist, ['an item'])
  assert.equal(accepted.content, 'A note')
  assert.equal(api.attempts.length, 0)
  first.close()

  api.online(true)
  const reloaded = api.queue()
  api.respond(() => { throw new WorkspaceCommandError('network', 'Reply lost') })
  await reloaded.flush()
  assert.equal(api.operations.size, 1)
  reloaded.close()

  api.respond(() => ({ note: null }))
  await api.queue().flush()
  assert.deepEqual(api.attempts, [accepted, accepted])
  assert.equal(api.operations.size, 0)
  assert.equal(api.revealed(), 1)
  assert.match(api.status().message ?? '', /later deleted/)
})

test('expired sessions, account switching and project switching never replay a capture under a different identity', async () => {
  const api = fixture()
  const original = api.queue()
  await original.submit({ content: 'Private text' })
  original.close()
  api.online(true)
  await api.queue('project-a/owner-b').flush()
  await api.queue('project-b/owner-a').flush()
  assert.equal(api.attempts.length, 0)
  assert.equal(api.operations.size, 1)
  api.respond(() => { throw new WorkspaceCommandError('auth', 'Session expired') })
  await api.queue().flush()
  assert.equal(api.operations.size, 1)
  assert.equal(api.auth(), 1)
  api.respond(() => ({ note: {} }))
  await api.queue().flush()
  assert.deepEqual(api.attempts.map(({ id }) => id), [api.attempts[0].id, api.attempts[0].id])
  assert.equal(api.operations.size, 0)
})

test('capacity and missing boards cause a durable failure until explicitly retried or discarded', async () => {
  const api = fixture()
  const queue = api.queue()
  await queue.submit({ content: '', checklist: ['Checklist only'], boardId: 'board-full' })
  await queue.flush()
  api.online(true)
  api.respond(() => { throw new WorkspaceCommandError('rejected', 'This board has 60 active notes.') })
  await queue.flush()
  const [failed] = api.operations.values()
  assert.match(failed.error ?? '', /60 active notes/)
  await queue.flush()
  assert.equal(api.attempts.length, 1)
  api.respond(() => { throw new WorkspaceCommandError('rejected', 'Board unavailable.') })
  await queue.change(failed.id, true)
  await queue.flush()
  assert.equal(api.attempts[1].id, failed.id)
  assert.match(api.operations.get(failed.id)?.error ?? '', /unavailable/)
  await queue.change(failed.id, false)
  assert.equal(api.operations.size, 0)
})

test('invalid text and storage failure produce no RPC call', async () => {
  const api = fixture()
  const queue = api.queue()
  await assert.rejects(queue.submit({ content: '🔬'.repeat(121) }), /240/)
  await assert.rejects(queue.submit({ content: '', checklist: [] }), /240/)
  assert.equal(api.operations.size, 0)
  const blocked = createQuickCapture({
    storage: { list: async () => [], save: async () => { throw Error('Storage is blocked') }, remove: async () => {} },
    online: () => true, send: async () => { assert.fail('A capture without a saved UUID must not be sent') },
    onState: () => {}, onCaptured: () => {}, onAuth: () => {}, canSend: () => true,
  })
  await assert.rejects(blocked.submit({ content: 'Keep this input' }), /Storage is blocked/)
})
