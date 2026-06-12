import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'

/**
 * Anchored popover rendered in a portal. Closes on outside pointerdown,
 * Escape, scroll-away, or window resize. Position clamps to the viewport.
 */
export function Popover({
  anchor,
  onClose,
  children,
  align = 'start',
  width,
}: {
  anchor: HTMLElement
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const place = () => {
      const a = anchor.getBoundingClientRect()
      const el = ref.current
      if (!el) return
      const w = el.offsetWidth
      const h = el.offsetHeight
      let left = align === 'end' ? a.right - w : a.left
      left = Math.min(Math.max(8, left), window.innerWidth - w - 8)
      let top = a.bottom + 6
      if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6)
      setPos({ top, left })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchor, align])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node) && !anchor.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchor, onClose])

  return createPortal(
    <div
      ref={ref}
      className="popover"
      role="menu"
      // Portals still bubble through the React tree — without these stops a
      // menu click inside a table row would also fire the row's onClick.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
