import { forwardRef } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  active?: boolean
  children: ReactNode
}

export const IconButton = forwardRef<HTMLButtonElement, Props>(function IconButton({ label, active, children, className = '', ...props }, ref) {
  return <button ref={ref} type="button" className={`icon-button ${active ? 'is-active' : ''} ${className}`}
    aria-label={label} aria-pressed={active === undefined ? undefined : active} data-tooltip={label} {...props}>{children}</button>
})
