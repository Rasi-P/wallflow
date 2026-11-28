import { CalendarDays, Check, CircleAlert, Search, Settings2, Zap } from 'lucide-react'
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

export function Header({ compact = false, onCapture }: { compact?: boolean; onCapture?: () => void } = {}) {
  const tasksOpen = useWallStore((s) => s.tasksOpen)
  const linked = useWorkspaceStore((s) => workspace.isLinked(s.activeBoardId))
  const accountStatus = useLinkedBoard((s) => s.status)
  const accountMessage = useLinkedBoard((s) => s.message)
  const pendingCaptures = useLinkedBoard((s) => compact ? s.capture?.entries.length ?? 0 : 0)
  const durable = useLinkedBoard((s) => s.durable)
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
    ? accountStatus === 'saved' ? 'Synced to account'
      : accountStatus === 'conflict' ? 'Conflict needs attention'
        : accountStatus === 'offline' ? 'Offline · waiting to sync'
          : accountStatus === 'unsaved' ? 'Draft needs attention'
            : durable ? 'Saved on this device' : 'Saving on this device…'
    : saved ? 'Saved on this device' : 'Session only · storage unavailable'
  const saveError = linked ? ['conflict', 'unsaved', 'unavailable', 'offline'].includes(accountStatus) : !saved
  return <header className="app-header">
    <div className="brand-group">
      <a href="./" className="brand" aria-label="WALLFLOW home"><img src="/favicon.svg" alt="" /><span>WALLFLOW<span className="brand-period">.</span></span></a>
      <span className="header-divider" />
      <BoardNavigation compact={compact} />
    </div>
    <div className="header-actions"><span className={`save-status${linked ? ' save-status--supabase' : ''}${saveError ? ' is-error' : ''}`} role="status"
      title={saveError ? linked ? accountMessage : 'Changes are saved for this session only' : undefined}>
      {saveError ? <CircleAlert size={16} aria-hidden="true" /> : <Check size={13} />}<span>{savedLabel}</span></span>
      {compact && <IconButton label="Quick Capture" className="compact-capture-trigger" aria-haspopup="dialog"
        onClick={onCapture}><Zap size={19} />{pendingCaptures > 0 &&
          <span className="daily-progress-badge" aria-label={`${pendingCaptures} pending captures`}>{pendingCaptures}</span>}</IconButton>}
      <IconButton id="wall-task-panel-trigger" data-tour-anchor="tasks" label="Today, reminders, and archive" data-tooltip="Today & tasks" active={tasksOpen} aria-expanded={tasksOpen}
        aria-controls={tasksOpen ? 'wall-task-panel' : undefined} onClick={() => useWallStore.getState().setPanel('tasksOpen', !tasksOpen)}><CalendarDays size={18} /><DailyProgressBadge /></IconButton>
      <IconButton data-tour-anchor="find" label="Find notes and sections" data-tooltip="Find on wall (Ctrl/⌘ K)" aria-keyshortcuts="Control+k Meta+k" onClick={() => useWallStore.getState().setPanel('searchOpen', true)}><Search size={19} /></IconButton>
      <IconButton label="Wall settings" onClick={() => useWallStore.getState().setPanel('settingsOpen', true)}><Settings2 size={19} /></IconButton>
    </div>
  </header>
}
