import { useId, useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'

export function Modal({ title, children, onClose, headerAction, className = '' }: {
  title: string; children: ReactNode; onClose: () => void; headerAction?: ReactNode; className?: string
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  useLayoutEffect(() => {
    const element = dialog.current
    const opener = document.activeElement
    if (!element) return
    element.showModal()
    element.querySelector<HTMLElement>('[data-initial-focus]')?.focus({ preventScroll: true })
    return () => {
      element.close()
      if (opener instanceof HTMLElement && opener.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true })
    }
  }, [])
  const close = <IconButton label="Close dialog" onClick={onClose}><X size={19} /></IconButton>
  return <dialog ref={dialog} className={`modal ${className}`} onCancel={(event) => { event.preventDefault(); onClose() }}
    onClick={(e) => { if (e.target === e.currentTarget) { const box = e.currentTarget.getBoundingClientRect(); if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onClose() } }} aria-labelledby={titleId}>
    <div className="modal-header"><h2 id={titleId}>{title}</h2>
      {headerAction ? <div className="modal-header-actions">{headerAction}{close}</div> : close}
    </div>
    {children}
  </dialog>
}
