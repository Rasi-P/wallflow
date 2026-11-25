export function captureNotePointer(target: EventTarget | null, pointerId: number) {
  const capture = target as Pick<Element, 'setPointerCapture' | 'releasePointerCapture'> | null
  capture?.setPointerCapture(pointerId)
  return () => {
    try { capture?.releasePointerCapture(pointerId) } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
    }
  }
}

export function watchNotePointer(
  scope: EventTarget,
  surface: EventTarget,
  pointerId: number,
  isTouch: boolean,
  cancel: () => void,
  nextFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame,
) {
  const listeners = new AbortController()
  const { signal } = listeners
  const matches = (event: Event) => (event as PointerEvent).pointerId === pointerId

  // R3F handles cancellation internally without forwarding it to mesh handlers.
  scope.addEventListener('pointercancel', (event) => { if (matches(event)) cancel() }, { signal })
  scope.addEventListener('lostpointercapture', (event) => {
    if (!matches(event)) return
    // Let a normal pointer-up commit before treating capture loss as a cancellation.
    nextFrame(() => { if (!signal.aborted) cancel() })
  }, { signal })
  scope.addEventListener('blur', cancel, { signal })
  scope.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    cancel()
  }, { capture: true, signal })

  if (isTouch) scope.addEventListener('pointerdown', (event) => {
    if ((event as PointerEvent).pointerType === 'touch' && !matches(event) && event.target === surface) cancel()
  }, { capture: true, signal })

  return () => listeners.abort()
}
