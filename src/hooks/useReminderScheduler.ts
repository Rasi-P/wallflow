import { useEffect } from 'react'
import { useWallStore } from '../stores/wallStore'
import { browserReminderNotifications, deliverReminders, reminderDelay } from '../utils/reminders'

export function useReminderScheduler() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let checking = false
    function refresh() {
      if (checking) return
      checking = true
      try {
        clearTimeout(timer)
        const state = useWallStore.getState()
        const notifications = browserReminderNotifications()
        const { delivered, nextAt, failed } = deliverReminders(state.notes, state.notifiedReminders, Date.now(), notifications)
        if (delivered.length) state.markRemindersNotified(delivered)
        state.setReminderPermission(failed ? 'unavailable' : notifications?.permission ?? 'unavailable')
        if (nextAt !== undefined) timer = setTimeout(refresh, reminderDelay(nextAt))
      } finally {
        checking = false
      }
    }
    const unsubscribe = useWallStore.subscribe((state, previous) => {
      if (state.notes !== previous.notes || state.notifiedReminders !== previous.notifiedReminders ||
        state.reminderPermission !== previous.reminderPermission) refresh()
    })
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      unsubscribe()
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
}
