import { useEffect } from 'react'
import { useWallStore } from '../stores/wallStore'
import { localDay } from '../utils/taskDates'

export function useLocalDay() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    function refresh() {
      clearTimeout(timer)
      const now = new Date()
      useWallStore.getState().setToday(localDay(now))
      const next = new Date(now)
      next.setHours(24, 0, 0, 50)
      timer = setTimeout(refresh, next.getTime() - now.getTime())
    }
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
}
