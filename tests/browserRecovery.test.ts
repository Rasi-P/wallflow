import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createBoardStore, snapshotBoard } from '../src/stores/boardStore.ts'
import { browserExportFormat, parseBrowserExport, parseWorkspaceBackup, reviewBrowserSource, workspaceBackupFormat } from '../src/utils/browserRecovery.ts'

const board = snapshotBoard('first-board', createBoardStore().getState())
const sourceId = '10000000-0000-4000-8000-000000000001'
const encode = (boards: unknown[]) => JSON.stringify({ format: browserExportFormat, boards })

test('portable browser recovery preserves board data, source IDs and exact RPC digests', async () => {
  const entry = { board, sourceId }
  const [parsed] = parseBrowserExport(encode([entry]))
  assert.deepEqual(parsed, entry)
  const reviewed = await reviewBrowserSource(parsed)
  assert.equal(reviewed.snapshot, JSON.stringify(board))
  assert.equal(reviewed.snapshotDigest, createHash('sha256').update(reviewed.snapshot).digest('hex'))
})

test('unsigned legacy files remain in review, and malformed or duplicate portable records are rejected', () => {
  const entry = { board, sourceId }
  assert.throws(() => parseBrowserExport(JSON.stringify([board])), /need review/)
  assert.throws(() => parseBrowserExport(JSON.stringify({ version: 2, boardOrder: [board.id] })), /need review/)
  assert.throws(() => parseBrowserExport(encode([entry, entry])), /invalid or repeated/)
  assert.throws(() => parseBrowserExport(encode([{ ...entry, sourceId: 'missing' }])), /invalid or repeated/)
  assert.throws(() => parseBrowserExport(encode([{ ...entry, board: { ...board, name: '' } }])), /invalid or repeated/)
})

test('account backups keep their version 2 payload and reject other accounts, origins and corrupt files', () => {
  const owner = { accountId: 'the-owner', project: 'https://project.example.invalid' }
  const workspace = { version: 2, boardOrder: [board.id], activeBoardId: board.id, boards: { [board.id]: board } }
  const backup = { format: workspaceBackupFormat, ...owner, workspace }
  assert.deepEqual(parseWorkspaceBackup(JSON.stringify(backup), owner), workspace)
  assert.throws(() => parseWorkspaceBackup(JSON.stringify(backup), { ...owner, accountId: 'another-owner' }), /this account/)
  assert.throws(() => parseWorkspaceBackup(JSON.stringify(backup), { ...owner, project: 'https://other.example.invalid' }), /this account/)
  assert.throws(() => parseWorkspaceBackup(JSON.stringify({ ...backup, workspace: { ...workspace, boardOrder: [] } }), owner), /this account/)
  assert.throws(() => parseWorkspaceBackup('{"workspace": sensitive-truncated-input}', owner), (error: unknown) =>
    error instanceof Error && /not valid JSON/.test(error.message) && !error.message.includes('sensitive-truncated-input'))
})
