import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '../lib/types'
import { recentNotes, searchVault } from '../lib/store'
import { navigate } from '../lib/router'
import { relativeTime, titleFromPath } from '../lib/format'
import { isProtectedNote } from '../domain/scripts'
import { IconShield } from '../components/Icons'

export function LibraryView() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Note[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const id = ++seq.current
    const q = query.trim()
    setBusy(true)
    setError(null)
    const timer = setTimeout(
      () => {
        const run = q ? searchVault(q) : recentNotes()
        run
          .then((notes) => {
            if (seq.current === id) setResults(notes)
          })
          .catch((e) => {
            if (seq.current === id) setError(e instanceof Error ? e.message : String(e))
          })
          .finally(() => {
            if (seq.current === id) setBusy(false)
          })
      },
      q ? 250 : 0,
    )
    return () => clearTimeout(timer)
  }, [query])

  const grouped = useMemo(() => {
    const groups = new Map<string, Note[]>()
    for (const n of results ?? []) {
      const top = n.path.includes('/') ? n.path.split('/')[0]! : '·root'
      const list = groups.get(top) ?? []
      list.push(n)
      groups.set(top, list)
    }
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [results])

  return (
    <div className="library">
      <header className="db-head">
        <div className="db-title-row">
          <h1 className="db-title">Library</h1>
          <span className="db-count">{results ? results.length : ''}</span>
        </div>
        <input
          autoFocus
          className="library-search"
          placeholder="Search everything in the vault…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <p className="library-hint">
          {query.trim()
            ? busy
              ? 'Searching…'
              : 'Full-text search across every note'
            : 'Most recent notes'}
        </p>
      </header>

      {error && (
        <div className="db-state">
          <p className="db-state-title">Search failed</p>
          <p className="db-state-msg">{error}</p>
        </div>
      )}

      {!error &&
        grouped.map(([folder, notes]) => (
          <section key={folder} className="lib-group">
            <h2 className="lib-folder">{folder === '·root' ? '/' : folder}</h2>
            {notes.map((n) => (
              <button
                key={n.path}
                className="lib-row"
                onClick={() => navigate({ kind: 'note', path: n.path })}
              >
                <span className="lib-title">
                  {titleFromPath(n.path)}
                  {isProtectedNote(n) && (
                    <span className="canon-mini" title="Founder canon — human-gated">
                      <IconShield size={11} />
                    </span>
                  )}
                </span>
                <span className="lib-path">{n.path}</span>
                <span className="lib-tags">
                  {n.tags.slice(0, 3).map((t) => (
                    <span key={t} className="lib-tag">
                      #{t}
                    </span>
                  ))}
                </span>
                <span className="lib-updated">{relativeTime(n.updatedAt)}</span>
              </button>
            ))}
          </section>
        ))}

      {!error && results && results.length === 0 && (
        <div className="db-state">
          <p className="db-state-title">Nothing found</p>
          <p className="db-state-msg">No notes match “{query.trim()}”.</p>
        </div>
      )}
    </div>
  )
}
