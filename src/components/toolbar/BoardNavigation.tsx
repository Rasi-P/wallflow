import { useState } from 'react'
import { ChevronLeft, ChevronRight, Layers } from 'lucide-react'
import { useWallStore, useWorkspaceStore, workspace } from '../../stores/wallStore'
import { BoardManagementDialog } from '../ui/BoardManagementDialog'
import { IconButton } from '../ui/IconButton'
import type { BoardId } from '../../types/workspace'

export function BoardNavigation() {
  const activeId = useWorkspaceStore((state) => state.activeBoardId)
  const order = useWorkspaceStore((state) => state.boardOrder)
  const name = useWorkspaceStore((state) => state.boards[state.activeBoardId]?.name)
  const dragging = useWallStore((state) => state.draggingId !== null)
  const [managedId, setManagedId] = useState<BoardId | null>(null)
  const managedName = useWorkspaceStore((state) => managedId === null ? undefined : state.boards[managedId]?.name)
  const index = order.indexOf(activeId)

  return <>
    <nav className="board-navigation" aria-label="Boards">
      <IconButton label="Previous board" data-tooltip="Previous board ([)" aria-keyshortcuts="[" disabled={dragging || index === 0}
        onClick={() => workspace.stepBoard(-1)}><ChevronLeft size={17} aria-hidden="true" /></IconButton>
      <span className="board-position" title={name} aria-live="polite" aria-atomic="true">
        <span className="board-name">{name}</span>
        <span className="board-index"> · {index + 1} of {order.length}</span>
      </span>
      <IconButton label="Next board" data-tooltip="Next board (])" aria-keyshortcuts="]" disabled={dragging || index === order.length - 1}
        onClick={() => workspace.stepBoard(1)}><ChevronRight size={17} aria-hidden="true" /></IconButton>
      <IconButton label="Manage boards" className="manage-boards-button" aria-haspopup="dialog" disabled={dragging} onClick={() => {
        if (useWallStore.getState().draggingId) return
        useWallStore.getState().finishEditing()
        setManagedId(activeId)
      }}><Layers size={16} aria-hidden="true" /></IconButton>
    </nav>
    {managedId && managedName && <BoardManagementDialog boardId={managedId} boardName={managedName} canDelete={order.length > 1} onClose={() => setManagedId(null)} />}
  </>
}
