import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({
  onClose,
  children,
  width = 460,
  labelledBy,
}: {
  onClose: () => void
  children: ReactNode
  width?: number
  labelledBy?: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // An open popover claims the Escape first.
        if (document.querySelector('.popover')) return
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return createPortal(
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        style={{ width }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
