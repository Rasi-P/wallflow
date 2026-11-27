import type { createSupabaseWorkspaceCommands } from '../auth/supabaseWorkspaceCommands.ts'
import type { LinkedDocument } from '../auth/linkedWallApi.ts'
import type { Board } from '../types/workspace.ts'
import { lockSource, protectSource, readSource, recordSource, releaseSource, restoreSourceProtection } from '../utils/boardLinkStorage'
import { downloadSnapshot } from './linkedBoard'
import { workspace } from './wallStore'

export function createSupabaseBrowserImports(
  api: ReturnType<typeof createSupabaseWorkspaceCommands>,
  accountKey: string,
  stopped: () => boolean,
  publish: (state: { importCount: number; hasRecovery: boolean; recoveryPending: boolean }) => void,
) {
  let claimed = new Set<string>()
  let sourcesReady = false
  let active = false

  function pendingForThisAccount(boardId: string) {
    const source = readSource(boardId)
    return source?.phase === 'pending' && source.accountId === accountKey
  }

  function publishSources() {
    if (stopped()) return
    publish({
      importCount: sourcesReady ? workspace.importableBoards().length : 0,
      hasRecovery: workspace.localIds().some((id) => claimed.has(readSource(id)?.sourceId ?? '')),
      recoveryPending: workspace.localIds().some(pendingForThisAccount),
    })
  }

  function setClaimed(ids: string[]) {
    if (stopped()) return
    claimed = new Set(ids)
    for (const id of workspace.localIds()) {
      const source = readSource(id)
      if (source && claimed.has(source.sourceId) && source.phase !== 'linked') {
        recordSource(id, { sourceId: source.sourceId, phase: 'linked' })
      }
    }
    publishSources()
  }

  async function recover() {
    if (active || stopped()) return
    active = true
    try {
      await restoreSourceProtection()
      if (stopped()) return
      sourcesReady = true
      setClaimed(Array.from(claimed))
      for (const boardId of workspace.localIds().filter(pendingForThisAccount)) {
        await lockSource(boardId, async (source) => {
          if (stopped() || !pendingForThisAccount(boardId)) return
          const result = await api.recover(source.sourceId)
          if (stopped()) return
          if (result === 'available') await releaseSource(boardId, source.sourceId)
          if (result === 'claimed') recordSource(boardId, { sourceId: source.sourceId, phase: 'linked' })
        })
      }
    } finally {
      active = false
      publishSources()
    }
  }

  async function confirm(base: LinkedDocument, boards: Board[]) {
    if (!boards.length || new Set(boards.map(({ id }) => id)).size !== boards.length) {
      throw new Error('Choose the browser boards to import.')
    }
    if (active) throw new Error('Wait for browser recovery to finish and try again.')
    active = true
    const ids = boards.map(({ id }) => id).sort()
    const sources = new Map<string, string>()

    function verifyReview() {
      if (stopped() || boards.some((board) => !workspace.matchesStoredSnapshot(board))) {
        throw new Error('The browser boards changed. Review the originals and try again.')
      }
    }

    async function send() {
      verifyReview()
      if (boards.some(({ id }) => !workspace.keepLocalSnapshot(id))) {
        throw new Error('The browser originals could not be kept. The import was cancelled.')
      }
      const reviewed = await Promise.all(boards.map(async (board) => {
        const snapshot = JSON.stringify(board)
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(snapshot))
        const snapshotDigest = Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
        return { boardId: board.id, sourceId: sources.get(board.id)!, snapshot, snapshotDigest }
      }))
      const intents = await api.prepare(reviewed.map(({ sourceId, snapshotDigest }) => ({ sourceId, snapshotDigest })))
      verifyReview()
      for (const { boardId, sourceId } of reviewed) await protectSource(boardId, { sourceId, phase: 'pending', accountId: accountKey })
      verifyReview()
      try {
        return await api.confirm(crypto.randomUUID(), base.revision, reviewed.map(({ snapshot }, index) => ({ intentId: intents[index], snapshot })))
      } catch (error) {
        const saved = await api.read().catch(() => undefined)
        if (saved && reviewed.every(({ sourceId }) => saved.claimedSources.includes(sourceId))) return saved
        throw error
      }
    }

    function next(index: number): Promise<LinkedDocument> {
      if (index === ids.length) return send()
      const id = ids[index]
      return lockSource(id, async (source) => {
        if (source.phase !== 'local') throw new Error('This browser board is protected by a previous import.')
        sources.set(id, source.sourceId)
        return next(index + 1)
      })
    }

    try {
      const saved = await next(0)
      if (!stopped()) setClaimed(saved.claimedSources)
      return saved
    } finally {
      active = false
      publishSources()
    }
  }

  return {
    setClaimed, recover, confirm,
    download() {
      const boards = workspace.localIds().filter((id) => claimed.has(readSource(id)?.sourceId ?? ''))
        .flatMap((id) => workspace.recoverySnapshot(id) ?? [])
      if (boards.length) downloadSnapshot(boards, 'wallflow-browser-recovery.json')
    },
  }
}
