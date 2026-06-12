import { useEffect } from 'react'
import { dismissToast, useStore, type ToastItem } from '../lib/store'
import { IconClose } from './Icons'

function Toast({ item }: { item: ToastItem }) {
  useEffect(() => {
    const ms = item.kind === 'error' ? 7000 : 3800
    const t = setTimeout(() => dismissToast(item.id), ms)
    return () => clearTimeout(t)
  }, [item.id, item.kind])

  return (
    <div className={`toast toast-${item.kind}`} role="status">
      <span className="toast-text">{item.text}</span>
      {item.action && (
        <button
          className="toast-action"
          onClick={() => {
            item.action!.run()
            dismissToast(item.id)
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => dismissToast(item.id)}
      >
        <IconClose size={12} />
      </button>
    </div>
  )
}

export function ToastHost() {
  const { toasts } = useStore()
  if (toasts.length === 0) return null
  return (
    <div className="toast-host">
      {toasts.map((t) => (
        <Toast key={t.id} item={t} />
      ))}
    </div>
  )
}
