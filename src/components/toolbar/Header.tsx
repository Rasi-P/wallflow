import { CalendarDays, Check, CircleAlert, Search, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useLinkedBoard } from '../../stores/linkedBoard'
import { useWorkspaceStore, workspace, useWallStore } from '../../stores/wallStore'
import { storageHealth } from '../../utils/storage'
import { IconButton } from '../ui/IconButton'
import { dailyProgress } from '../../utils/dailyPlan'
import { BoardNavigation } from './BoardNavigation'

function DailyProgressBadge() {
  const notes = useWallStore((state) => state.notes)
  const today = useWallStore((state) => state.today)
  const { total, completed } = useMemo(() => dailyProgress(notes, today), [notes, today])
  if (!total) return null
  return <span className="daily-progress-badge" aria-hidden="true">{completed}/{total}</span>
}

export function Header() {
  const tasksOpen = useWallStore((s) => s.tasksOpen)
  const linked = useWorkspaceStore((s) => workspace.isLinked(s.activeBoardId))
  const accountStatus = useLinkedBoard((s) => s.status)
  const accountMessage = useLinkedBoard((s) => s.message)
  const [saved, setSaved] = useState(storageHealth.available)
  useEffect(() => {
    const update = () => setSaved(storageHealth.available)
    window.addEventListener('wallflow-storage-error', update)
    window.addEventListener('wallflow-storage-restored', update)
    update()
    return () => {
      window.removeEventListener('wallflow-storage-error', update)
      window.removeEventListener('wallflow-storage-restored', update)
    }
  }, [])
  const savedLabel = linked
    ? accountStatus === 'saved' ? 'Saved to your account' : accountStatus === 'saving' ? 'Saving to your account…'
      : accountStatus === 'unavailable' ? 'Account sync unavailable' : 'Account board · unsaved changes'
    : saved ? 'Saved on this device' : 'Session only · storage unavailable'
  const saveError = linked ? accountStatus === 'conflict' || accountStatus === 'unsaved' || accountStatus === 'unavailable' : !saved
  return <header className="app-header">
    <div className="brand-group">
      <a href="./" className="brand" aria-label="WALLFLOW home"><img src="/favicon.svg" alt="" /><span>WALLFLOW<span className="brand-period">.</span></span></a>
      <span className="header-divider" />
      <BoardNavigation />
    </div>
    <div className="header-actions"><span className={`save-status${saveError ? ' is-error' : ''}`} role="status"
      title={saveError ? linked ? accountMessage : 'Changes are saved for this session only' : undefined}>
      {saveError ? <CircleAlert size={16} aria-hidden="true" /> : <Check size={13} />}<span>{savedLabel}</span></span>
      <IconButton id="wall-task-panel-trigger" data-tour-anchor="tasks" label="Today, reminders, and archive" data-tooltip="Today & tasks" active={tasksOpen} aria-expanded={tasksOpen}
        aria-controls={tasksOpen ? 'wall-task-panel' : undefined} onClick={() => useWallStore.getState().setPanel('tasksOpen', !tasksOpen)}><CalendarDays size={18} /><DailyProgressBadge /></IconButton>
      <IconButton data-tour-anchor="find" label="Find notes and sections" data-tooltip="Find on wall (Ctrl/⌘ K)" aria-keyshortcuts="Control+k Meta+k" onClick={() => useWallStore.getState().setPanel('searchOpen', true)}><Search size={19} /></IconButton>
      <IconButton label="Wall settings" onClick={() => useWallStore.getState().setPanel('settingsOpen', true)}><Settings2 size={19} /></IconButton>
    </div>
  </header>
}
