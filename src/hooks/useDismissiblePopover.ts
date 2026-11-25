import { useEffect } from 'react'
import type { RefObject } from 'react'

export function useDismissiblePopover(
  open: boolean | string | null,
  content: RefObject<HTMLElement | null>,
  trigger: RefObject<HTMLButtonElement | null>,
  close: () => void,
) {
  useEffect(() => {
    if (!open) return
    const first = content.current?.querySelector<HTMLElement>('[data-initial-focus]') ??
      content.current?.querySelector<HTMLElement>('button:not(:disabled), select:not(:disabled)')
    first?.focus({ preventScroll: true })
    function outside(event: Event) {
      const target = event.target
      if (target instanceof Node && !content.current?.contains(target) && !trigger.current?.contains(target)) close()
    }
    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopPropagation()
      close()
      trigger.current?.focus({ preventScroll: true })
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('focusin', outside, true)
    window.addEventListener('keydown', escape, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('focusin', outside, true)
      window.removeEventListener('keydown', escape, true)
    }
  }, [open, content, trigger, close])
}
