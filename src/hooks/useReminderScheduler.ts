import { useEffect } from 'react'
import { useWallStore, workspace } from '../stores/wallStore'
import { browserReminderNotifications, deliverWorkspaceReminders, reminderDelay } from '../utils/reminders'

export function useReminderScheduler() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let checking = false
    function refresh() {
      if (checking) return
      checking = true
      try {
        clearTimeout(timer)
        const notifications = browserReminderNotifications()
        const { receipts, nextAt, failed } = deliverWorkspaceReminders(workspace.getState(), Date.now(), notifications)
        for (const { boardId, ids } of receipts) workspace.markBoardRemindersNotified(boardId, ids)
        useWallStore.getState().setReminderPermission(failed ? 'unavailable' : notifications?.permission ?? 'unavailable')
        if (nextAt !== undefined) timer = setTimeout(refresh, reminderDelay(nextAt))
      } finally {
        checking = false
      }
    }
    const unsubscribeWorkspace = workspace.subscribe((state, previous) => {
      if (state.boardOrder !== previous.boardOrder || state.boardOrder.some((id) =>
        state.boards[id].document.notes !== previous.boards[id].document.notes ||
        state.boards[id].notifiedReminders !== previous.boards[id].notifiedReminders)) refresh()
    })
    const unsubscribeWall = useWallStore.subscribe((state, previous) => {
      if (state.reminderPermission !== previous.reminderPermission) refresh()
    })
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      unsubscribeWorkspace()
      unsubscribeWall()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
}
