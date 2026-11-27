import type { Board, SavedWorkspace } from '../types/workspace.ts'
import { stableJson } from './jsonContent.ts'

export const sameWorkspaceValue = (left: unknown, right: unknown) => stableJson(left) === stableJson(right)

export function mergeWorkspace(base: SavedWorkspace, local: SavedWorkspace, remote: SavedWorkspace) {
  const conflicts = new Set<string>()

  function choose<T>(before: T, ours: T, theirs: T, path: string): T {
    if (sameWorkspaceValue(ours, before)) return theirs
    if (sameWorkspaceValue(theirs, before) || sameWorkspaceValue(ours, theirs)) return ours
    conflicts.add(path)
    return ours
  }

  function order(before: string[], ours: string[], theirs: string[], alive: ReadonlySet<string>, path: string) {
    // Compare only shared survivors for reorder conflicts. Concurrent additions
    // retain their relative positions where possible and never disappear.
    const shared = new Set(before.filter((id) => alive.has(id) && ours.includes(id) && theirs.includes(id)))
    const sharedOrder = (ids: string[]) => ids.filter((id) => shared.has(id))
    const chosen = choose(sharedOrder(before), sharedOrder(ours), sharedOrder(theirs), path)
    const primary = sameWorkspaceValue(chosen, sharedOrder(theirs)) ? theirs : ours
    const secondary = primary === theirs ? ours : theirs
    const result = primary.filter((id) => alive.has(id))
    for (const [index, id] of secondary.entries()) {
      if (!alive.has(id) || result.includes(id)) continue
      const next = secondary.slice(index + 1).find((candidate) => result.includes(candidate))
      if (next === undefined) result.push(id)
      else result.splice(result.indexOf(next), 0, id)
    }
    return result
  }

  function list<T extends { id: string }>(before: T[], ours: T[], theirs: T[], path: string): T[] {
    if (sameWorkspaceValue(ours, before)) return theirs
    if (sameWorkspaceValue(theirs, before) || sameWorkspaceValue(ours, theirs)) return ours
    const map = (items: T[]) => new Map(items.map((entry) => [entry.id, entry]))
    const [oldItems, localItems, remoteItems] = [before, ours, theirs].map(map)
    const chosen = new Map<string, T>()
    for (const id of new Set([...oldItems.keys(), ...localItems.keys(), ...remoteItems.keys()])) {
      const item = choose(oldItems.get(id), localItems.get(id), remoteItems.get(id), `${path} ${id}`)
      if (item) chosen.set(id, item)
    }
    return order([...oldItems.keys()], [...localItems.keys()], [...remoteItems.keys()], new Set(chosen.keys()), `${path} order`)
      .map((id) => chosen.get(id)!)
  }

  function mergeBoard(before: Board, ours: Board, theirs: Board): Board {
    const path = `Board ${ours.name}`
    const sections = list(before.document.sections, ours.document.sections, theirs.document.sections, `${path} section`)
    const sectionIds = new Set(sections.map(({ id }) => id))
    const notes = list(before.document.notes, ours.document.notes, theirs.document.notes, `${path} note`).map((note) => {
      if (!note.sectionId || sectionIds.has(note.sectionId)) return note
      conflicts.add(`${path} section membership`)
      const unassigned = { ...note }
      delete unassigned.sectionId
      return unassigned
    })
    const receipts = [...new Set([...theirs.notifiedReminders, ...ours.notifiedReminders])].filter((id) =>
      !before.notifiedReminders.includes(id) || (theirs.notifiedReminders.includes(id) && ours.notifiedReminders.includes(id)))
    return {
      id: before.id,
      name: choose(before.name, ours.name, theirs.name, `${path} name`),
      document: {
        notes, sections,
        wallRotation: choose(before.document.wallRotation, ours.document.wallRotation, theirs.document.wallRotation, `${path} rotation`),
      },
      preferences: choose(before.preferences, ours.preferences, theirs.preferences, `${path} settings`),
      presentation: choose(before.presentation, ours.presentation, theirs.presentation, `${path} appearance`),
      notifiedReminders: receipts,
    }
  }

  const boards = new Map<string, Board>()
  for (const id of new Set([...base.boardOrder, ...local.boardOrder, ...remote.boardOrder])) {
    const [before, ours, theirs] = [base, local, remote].map(({ boards }) => boards[id])
    const board = before && ours && theirs && !sameWorkspaceValue(ours, before) && !sameWorkspaceValue(theirs, before)
      && !sameWorkspaceValue(ours, theirs)
      ? mergeBoard(before, ours, theirs)
      : choose(before, ours, theirs, `Board ${ours?.name ?? theirs?.name ?? before?.name ?? id}`)
    if (board) boards.set(id, board)
  }
  if (!boards.size) {
    conflicts.add('The final board')
    return { workspace: local, conflicts: Array.from(conflicts) }
  }
  const boardOrder = order(base.boardOrder, local.boardOrder, remote.boardOrder, new Set(boards.keys()), 'Board order')
  const selected = choose(base.activeBoardId, local.activeBoardId, remote.activeBoardId, 'Active board')
  return {
    workspace: {
      version: 2 as const, boardOrder, boards: Object.fromEntries(boards),
      activeBoardId: boards.has(selected) ? selected : boardOrder[0],
    },
    conflicts: Array.from(conflicts),
  }
}
