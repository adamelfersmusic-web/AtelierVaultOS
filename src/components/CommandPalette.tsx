import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useStore, disconnect } from '../lib/store'
import { closePalette, openNewScript } from '../lib/ui'
import { navigate } from '../lib/router'
import { fuzzyScore } from '../lib/fuzzy'
import { titleFromPath } from '../lib/format'
import { fieldByKey } from '../domain/scripts'
import { chipFor } from './Chip'
import {
  IconBoard,
  IconDisconnect,
  IconGallery,
  IconGraph,
  IconLibrary,
  IconPlus,
  IconScripts,
  IconTable,
} from './Icons'

interface Item {
  key: string
  group: 'actions' | 'scripts'
  label: string
  hint?: string
  dot?: string
  icon?: ReactNode
  run: () => void
}

export function CommandPalette() {
  const { scripts, notes } = useStore()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const statusField = fieldByKey('status')!

  const items = useMemo<Item[]>(() => {
    const actions: Item[] = [
      {
        key: 'new',
        group: 'actions',
        label: 'New script',
        icon: <IconPlus size={14} />,
        run: () => openNewScript(),
      },
      {
        key: 'table',
        group: 'actions',
        label: 'Scripts · Table',
        icon: <IconTable size={14} />,
        run: () => navigate({ kind: 'scripts', lens: 'table' }),
      },
      {
        key: 'board',
        group: 'actions',
        label: 'Scripts · Board',
        icon: <IconBoard size={14} />,
        run: () => navigate({ kind: 'scripts', lens: 'board' }),
      },
      {
        key: 'gallery',
        group: 'actions',
        label: 'Scripts · Gallery',
        icon: <IconGallery size={14} />,
        run: () => navigate({ kind: 'scripts', lens: 'gallery' }),
      },
      {
        key: 'graph',
        group: 'actions',
        label: 'Graph — the vault as a constellation',
        icon: <IconGraph size={14} />,
        run: () => navigate({ kind: 'graph' }),
      },
      {
        key: 'library',
        group: 'actions',
        label: 'Library — search the vault',
        icon: <IconLibrary size={14} />,
        run: () => navigate({ kind: 'library' }),
      },
      {
        key: 'disconnect',
        group: 'actions',
        label: 'Disconnect vault',
        icon: <IconDisconnect size={14} />,
        run: () => {
          disconnect()
          navigate({ kind: 'connect' })
        },
      },
    ]
    const scriptItems: Item[] = (scripts ?? []).map((path) => {
      const note = notes[path]
      const status = String(note?.metadata['status'] ?? '')
      const chip = chipFor(statusField, status || undefined)
      return {
        key: path,
        group: 'scripts',
        label: titleFromPath(path),
        hint: status || undefined,
        dot: chip.empty ? undefined : chip.color,
        icon: <IconScripts size={14} />,
        run: () => navigate({ kind: 'note', path }),
      }
    })

    const q = query.trim()
    if (!q) return [...actions, ...scriptItems.slice(0, 7)]
    const scored = [...actions, ...scriptItems]
      .map((item) => ({ item, score: fuzzyScore(q, item.label) }))
      .filter((x): x is { item: Item; score: number } => x.score !== null)
      .sort((a, b) => b.score - a.score)
    return scored.slice(0, 12).map((x) => x.item)
  }, [query, scripts, notes, statusField])

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    const el = listRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (item: Item | undefined) => {
    if (!item) return
    closePalette()
    item.run()
  }

  return createPortal(
    <div
      className="overlay overlay-top"
      onPointerDown={(e) => e.target === e.currentTarget && closePalette()}
    >
      <div className="palette" role="dialog" aria-label="Command palette">
        <input
          ref={inputRef}
          autoFocus
          className="palette-input"
          placeholder="Jump to a script, or run a command…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setActive((a) => Math.min(a + 1, items.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setActive((a) => Math.max(a - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(items[active])
            } else if (e.key === 'Escape') {
              closePalette()
            }
          }}
        />
        <div className="palette-list" ref={listRef}>
          {items.length === 0 && <div className="palette-empty">No matches</div>}
          {items.map((item, i) => (
            <button
              key={`${item.group}:${item.key}`}
              className="palette-item"
              data-active={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(item)}
            >
              <span className="palette-icon">{item.icon}</span>
              <span className="palette-label">{item.label}</span>
              {item.dot && <i className={`lane-dot dot-${item.dot}`} />}
              {item.hint && <span className="palette-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
        <div className="palette-foot">
          <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> open · <kbd>esc</kbd> close
        </div>
      </div>
    </div>,
    document.body,
  )
}
