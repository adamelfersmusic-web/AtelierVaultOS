import { useMemo, useState } from 'react'
import type { Note } from '../lib/types'
import { replaceTags, useStore } from '../lib/store'
import { IconClose, IconPlus } from './Icons'

/**
 * Inline tag editor. Every change is a human-initiated full-replace of the
 * note's tag set (sent to the vault as an add/remove diff under optimistic
 * concurrency).
 */
export function TagEditor({ note }: { note: Note }) {
  const { tags: vaultTags } = useStore()
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  const suggestions = useMemo(() => {
    const q = draft.trim().toLowerCase()
    if (!q) return []
    return vaultTags
      .filter(
        (t) => t.name.toLowerCase().includes(q) && !note.tags.includes(t.name),
      )
      .slice(0, 6)
  }, [draft, vaultTags, note.tags])

  const commit = (tag: string) => {
    const t = tag.trim()
    setDraft('')
    if (!t || note.tags.includes(t)) return
    void replaceTags(note.path, [...note.tags, t])
  }

  const remove = (tag: string) => {
    void replaceTags(
      note.path,
      note.tags.filter((t) => t !== tag),
    )
  }

  return (
    <div className="tag-editor">
      {note.tags.map((t) => (
        <span key={t} className="tag-token">
          <span className="tag-hash">#</span>
          {t}
          <button
            className="tag-remove"
            aria-label={`Remove tag ${t}`}
            onClick={() => remove(t)}
          >
            <IconClose size={10} />
          </button>
        </span>
      ))}
      {adding ? (
        <span className="tag-add-wrap">
          <input
            autoFocus
            className="tag-input"
            placeholder="add tag…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commit(draft)
              } else if (e.key === 'Escape') {
                setDraft('')
                setAdding(false)
              }
            }}
            onBlur={() => {
              if (!draft.trim()) setAdding(false)
            }}
          />
          {suggestions.length > 0 && (
            <div className="tag-suggest">
              {suggestions.map((s) => (
                <button
                  key={s.name}
                  className="tag-suggest-item"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    commit(s.name)
                  }}
                >
                  #{s.name}
                  <span className="tag-suggest-count">{s.count}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      ) : (
        <button className="tag-add" onClick={() => setAdding(true)}>
          <IconPlus size={11} /> tag
        </button>
      )}
    </div>
  )
}
