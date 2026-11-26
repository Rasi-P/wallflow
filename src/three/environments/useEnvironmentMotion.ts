import { useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { useEnvironmentMotionStore } from '../../stores/environmentMotionStore'
import type { MotionRoom } from '../../stores/environmentMotionStore'
import { useWallStore } from '../../stores/wallStore'
import { createEnvironmentMotionClock, createEnvironmentTicker } from './environmentMotion'

export function useEnvironmentMotion(room: MotionRoom, reducedMotion: boolean,
  update: (seconds: number, refreshShadows: boolean) => void) {
  const gl = useThree((state) => state.gl)
  const invalidate = useThree((state) => state.invalidate)
  const enabled = useEnvironmentMotionStore((state) => state[room])
  const busy = useWallStore((state) => Boolean(state.draggingId || state.editingId || state.settingsOpen ||
    state.searchOpen || state.helpOpen || state.tasksOpen))
  const advance = useMemo(createEnvironmentMotionClock, [])

  useLayoutEffect(() => {
    if (!enabled || reducedMotion || busy) return

    let active = true
    let inViewport = typeof IntersectionObserver === 'undefined'
    const run = createEnvironmentTicker((delta) => {
      if (document.hidden || !inViewport) {
        run(false)
        return
      }
      const { seconds, refreshShadows } = advance(delta)
      update(seconds, refreshShadows)
      if (refreshShadows) gl.shadowMap.needsUpdate = true
      invalidate()
    })
    const sync = () => run(active && inViewport && !document.hidden)
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      inViewport = (entries.at(-1)?.intersectionRatio ?? 0) >= 0.01
      sync()
    }, { threshold: 0.01 })
    observer?.observe(gl.domElement)
    document.addEventListener('visibilitychange', sync)
    sync()
    return () => {
      active = false
      observer?.disconnect()
      document.removeEventListener('visibilitychange', sync)
      run(false)
    }
  }, [advance, busy, enabled, gl, invalidate, reducedMotion, update])
}
