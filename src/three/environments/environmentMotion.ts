export const ENVIRONMENT_MOTION_INTERVAL_MS = 80
export const ENVIRONMENT_SHADOW_INTERVAL_MS = 1000

export function createEnvironmentMotionClock() {
  let elapsed = 0
  let lastShadow = 0
  return (delta: number) => {
    // A delayed timer should never teleport the leaves or require catch-up frames.
    elapsed += Math.min(ENVIRONMENT_MOTION_INTERVAL_MS * 3, Math.max(0, delta))
    const refreshShadows = elapsed - lastShadow >= ENVIRONMENT_SHADOW_INTERVAL_MS
    if (refreshShadows) lastShadow = elapsed
    return { seconds: elapsed / 1000, refreshShadows }
  }
}

const browserTimer = {
  now: () => performance.now(),
  schedule: (callback: () => void, delay: number) => globalThis.setTimeout(callback, delay),
  cancel: (timer: ReturnType<typeof setTimeout>) => globalThis.clearTimeout(timer),
}

export function createEnvironmentTicker(update: (delta: number) => void, timer = browserTimer) {
  let running = false
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let lastTick = 0

  function tick() {
    scheduled = undefined
    if (!running) return
    const now = timer.now()
    update(now - lastTick)
    lastTick = now
    if (running && scheduled === undefined) scheduled = timer.schedule(tick, ENVIRONMENT_MOTION_INTERVAL_MS)
  }

  return (visible: boolean) => {
    if (running === visible) return
    running = visible
    if (visible) {
      lastTick = timer.now()
      scheduled = timer.schedule(tick, ENVIRONMENT_MOTION_INTERVAL_MS)
    } else if (scheduled !== undefined) {
      timer.cancel(scheduled)
      scheduled = undefined
    }
  }
}
