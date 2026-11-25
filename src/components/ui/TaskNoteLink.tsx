import type { ReactNode } from 'react'
import type { StickyNoteData } from '../../types/wall'
import { NOTE_COLORS } from '../../utils/constants'

export function TaskNoteLink({ note, icon, children, onFocus }: {
  note: StickyNoteData
  icon: ReactNode
  children?: ReactNode
  onFocus: (id: string) => void
}) {
  return <button type="button" className="due-note-row" onClick={() => onFocus(note.id)}>
    <span className="task-paper-dot" style={{ background: NOTE_COLORS[note.color].paper }}>{icon}</span>
    <span><strong>{note.title || 'Untitled note'}</strong>{children}</span>
  </button>
}
