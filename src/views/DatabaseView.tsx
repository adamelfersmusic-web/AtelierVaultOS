import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DatabaseDef, FieldDef, LensKind, Note } from '../lib/types'
import { loadScripts, setMetadata, useStore } from '../lib/store'
import { navigate } from '../lib/router'
import { openNewScript } from '../lib/ui'
import { titleFromPath } from '../lib/format'
import { Chip, chipFor } from '../components/Chip'
import { Popover } from '../components/Popover'
import {
  IconBoard,
  IconCheck,
  IconClose,
  IconFilter,
  IconGallery,
  IconPlus,
  IconRefresh,
  IconSpark,
  IconTable,
  IconBack,
} from '../components/Icons'
import { TableLens } from './TableLens'
import { BoardLens } from './BoardLens'
import { GalleryLens } from './GalleryLens'

// The brand's source-of-truth project, opened in a new tab from the top bar.
const BRAND_BRAIN_URL = 'https://claude.ai/project/019df26a-e720-77a8-bfd1-1be88ba75aef'

export interface Row {
  path: string
  title: string
  note: Note
}

export interface LensProps {
  def: DatabaseDef
  rows: Row[]
  observed: Map<string, Set<string>>
  saving: Record<string, number>
  onOpen: (path: string) => void
  setField: (path: string, key: string, value: unknown, prev: unknown) => void
}

type SortState = { key: string; dir: 1 | -1 }
type Filters = Record<string, string[]>

const lensKey = (db: string) => `atelier.${db}.lens`
const sortKey = (db: string) => `atelier.${db}.sort`
const filterKey = (db: string) => `atelier.${db}.filters`

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function filterValueOf(field: FieldDef, note: Note): string {
  const v = note.metadata[field.key]
  if (field.kind === 'bool') return String(v === true)
  if (v === undefined || v === null || v === '') return ''
  return String(v)
}

export function rankOf(field: FieldDef, value: string): number {
  const order = field.rank ?? field.options?.map((o) => o.value)
  if (!order) return -1
  const i = order.indexOf(value)
  return i === -1 ? order.length : i
}

export function compareRows(a: Row, b: Row, sort: SortState, def: DatabaseDef): number {
  const dir = sort.dir
  if (sort.key === 'title') return a.title.localeCompare(b.title) * dir
  if (sort.key === 'updated') {
    return (a.note.updatedAt < b.note.updatedAt ? -1 : a.note.updatedAt > b.note.updatedAt ? 1 : 0) * dir
  }
  const field = def.fields.find((f) => f.key === sort.key)
  if (!field) return 0
  const va = filterValueOf(field, a.note)
  const vb = filterValueOf(field, b.note)
  if (va === vb) return a.title.localeCompare(b.title)
  // Unset values sink to the bottom regardless of direction.
  if (va === '') return 1
  if (vb === '') return -1
  const ra = rankOf(field, va)
  const rb = rankOf(field, vb)
  if (ra !== rb && ra !== -1 && rb !== -1) return (ra - rb) * dir
  return va.localeCompare(vb) * dir
}

// ---------------------------------------------------------------------------

function LensSwitch({ lens, onPick }: { lens: LensKind; onPick: (l: LensKind) => void }) {
  const lenses: { key: LensKind; label: string; icon: ReactNode }[] = [
    { key: 'table', label: 'Table', icon: <IconTable size={14} /> },
    { key: 'board', label: 'Board', icon: <IconBoard size={14} /> },
    { key: 'gallery', label: 'Gallery', icon: <IconGallery size={14} /> },
  ]
  const index = lenses.findIndex((l) => l.key === lens)
  return (
    <div className="lens-switch" role="tablist" aria-label="Lens">
      <i
        className="lens-thumb"
        style={{ transform: `translateX(${index * 100}%)` }}
        aria-hidden="true"
      />
      {lenses.map((l) => (
        <button
          key={l.key}
          role="tab"
          aria-selected={lens === l.key}
          className={`lens-btn${lens === l.key ? ' is-active' : ''}`}
          onClick={() => onPick(l.key)}
        >
          {l.icon}
          {l.label}
        </button>
      ))}
    </div>
  )
}

function Pipeline({
  def,
  rows,
  active,
  onToggle,
}: {
  def: DatabaseDef
  rows: Row[]
  active: string[]
  onToggle: (lane: string) => void
}) {
  const field = def.fields.find((f) => f.key === def.board.field)!
  const counts = new Map<string, number>()
  for (const lane of def.board.lanes) counts.set(lane, 0)
  for (const r of rows) {
    const v = filterValueOf(field, r.note)
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  }
  const lanes = [...counts.keys()]
  const total = rows.length || 1
  return (
    <div className="pipeline" role="group" aria-label="Pipeline">
      {lanes.map((lane) => {
        const n = counts.get(lane) ?? 0
        const { color } = chipFor(field, lane)
        const isActive = active.includes(lane)
        return (
          <button
            key={lane}
            className={`pipe-seg pipe-${color}${isActive ? ' is-active' : ''}${active.length > 0 && !isActive ? ' is-muted' : ''}`}
            style={{ flexGrow: Math.max(n, 0.45) * (100 / total) + 1 }}
            title={`${lane} — ${n} ${n === 1 ? 'script' : 'scripts'}`}
            onClick={() => onToggle(lane)}
          >
            <span className="pipe-label">{lane}</span>
            <span className="pipe-count">{n}</span>
          </button>
        )
      })}
    </div>
  )
}

function FilterMenu({
  def,
  observed,
  filters,
  anchor,
  onChange,
  onClose,
}: {
  def: DatabaseDef
  observed: Map<string, Set<string>>
  filters: Filters
  anchor: HTMLElement
  onChange: (next: Filters) => void
  onClose: () => void
}) {
  const [fieldKey, setFieldKey] = useState<string | null>(null)
  const field = def.fields.find((f) => f.key === fieldKey)

  if (!field) {
    return (
      <Popover anchor={anchor} onClose={onClose} width={200}>
        <div className="menu-label">Filter by</div>
        {def.fields.map((f) => (
          <button key={f.key} className="menu-item" onClick={() => setFieldKey(f.key)}>
            <span className="menu-item-text">{f.label}</span>
            {filters[f.key]?.length ? (
              <span className="menu-badge">{filters[f.key]!.length}</span>
            ) : null}
          </button>
        ))}
      </Popover>
    )
  }

  const declared = (field.options ?? []).map((o) => o.value)
  const extra = [...(observed.get(field.key) ?? [])].filter(
    (v) => v && !declared.includes(v),
  )
  const values = [...declared, ...extra.sort()]
  const selected = filters[field.key] ?? []

  const toggle = (v: string) => {
    const has = selected.includes(v)
    const nextVals = has ? selected.filter((x) => x !== v) : [...selected, v]
    const next = { ...filters }
    if (nextVals.length === 0) delete next[field.key]
    else next[field.key] = nextVals
    onChange(next)
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={216}>
      <button className="menu-back" onClick={() => setFieldKey(null)}>
        <IconBack size={12} /> {field.label}
      </button>
      {values.map((v) => {
        const { label, color } = chipFor(
          field,
          field.kind === 'bool' ? v === 'true' : v,
        )
        const on = selected.includes(v)
        return (
          <button
            key={v}
            className={`menu-item${on ? ' is-current' : ''}`}
            onClick={() => toggle(v)}
          >
            <Chip color={color} label={label} />
            {on && <IconCheck size={14} className="menu-check" />}
          </button>
        )
      })}
    </Popover>
  )
}

// ---------------------------------------------------------------------------

export function DatabaseView({
  def,
  lensOverride,
}: {
  def: DatabaseDef
  lensOverride?: LensKind
}) {
  const { notes, scripts, scriptsStatus, scriptsError, saving } = useStore()
  const [lens, setLensState] = useState<LensKind>(
    () => lensOverride ?? readJson<LensKind>(lensKey(def.key), 'table'),
  )
  const [sort, setSort] = useState<SortState>(() =>
    readJson<SortState>(sortKey(def.key), { key: 'updated', dir: -1 }),
  )
  const [filters, setFiltersState] = useState<Filters>(() =>
    readJson<Filters>(filterKey(def.key), {}),
  )
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const filterBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (lensOverride && lensOverride !== lens) {
      setLensState(lensOverride)
      localStorage.setItem(lensKey(def.key), JSON.stringify(lensOverride))
    }
  }, [lensOverride, lens, def.key])

  const setLens = (l: LensKind) => {
    setLensState(l)
    localStorage.setItem(lensKey(def.key), JSON.stringify(l))
    navigate({ kind: 'scripts', lens: l })
  }

  const setFilters = (f: Filters) => {
    setFiltersState(f)
    localStorage.setItem(filterKey(def.key), JSON.stringify(f))
  }

  const setSortPersist = (s: SortState) => {
    setSort(s)
    localStorage.setItem(sortKey(def.key), JSON.stringify(s))
  }

  const allRows = useMemo<Row[]>(() => {
    if (!scripts) return []
    return scripts
      .map((path) => notes[path])
      .filter((n): n is Note => Boolean(n))
      .map((note) => ({ path: note.path, note, title: titleFromPath(note.path) }))
  }, [scripts, notes])

  const observed = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const f of def.fields) map.set(f.key, new Set())
    for (const r of allRows) {
      for (const f of def.fields) {
        const v = filterValueOf(f, r.note)
        if (v) map.get(f.key)!.add(v)
      }
    }
    return map
  }, [allRows, def.fields])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let out = allRows
    if (q) {
      out = out.filter(
        (r) => r.title.toLowerCase().includes(q) || r.path.toLowerCase().includes(q),
      )
    }
    for (const [key, vals] of Object.entries(filters)) {
      if (vals.length === 0) continue
      const field = def.fields.find((f) => f.key === key)
      if (!field) continue
      out = out.filter((r) => vals.includes(filterValueOf(field, r.note)))
    }
    return [...out].sort((a, b) => compareRows(a, b, sort, def))
  }, [allRows, query, filters, sort, def])

  const setField = (path: string, key: string, value: unknown, prev: unknown) => {
    void setMetadata(path, { [key]: value }, { undo: { [key]: prev ?? null } })
  }

  const onOpen = (path: string) => navigate({ kind: 'note', path })

  const lensProps: LensProps = { def, rows, observed, saving, onOpen, setField }
  const statusFilters = filters[def.board.field] ?? []

  return (
    <div className="db">
      <header className="db-head">
        <div className="db-title-row">
          <h1 className="db-title">{def.title}</h1>
          <span className="db-count">
            {scriptsStatus === 'ready'
              ? `${rows.length}${rows.length !== allRows.length ? ` of ${allRows.length}` : ''}`
              : ''}
          </span>
          <button
            className="icon-btn db-refresh"
            title="Refresh from vault"
            onClick={() => void loadScripts()}
          >
            <IconRefresh size={14} />
          </button>
          <div className="db-actions">
            <a
              className="btn btn-brand"
              href={BRAND_BRAIN_URL}
              target="_blank"
              rel="noreferrer"
              title="Open the Brand Brain project in a new tab"
            >
              <IconSpark size={13} />
              Brand Brain
            </a>
            <input
              className="db-search"
              placeholder="Search scripts…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button
              ref={filterBtn}
              className={`btn btn-ghost${Object.keys(filters).length ? ' is-on' : ''}`}
              onClick={() => setFilterOpen(true)}
            >
              <IconFilter size={13} />
              Filter
            </button>
            <LensSwitch lens={lens} onPick={setLens} />
            <button className="btn btn-gold" onClick={openNewScript}>
              <IconPlus size={13} />
              New script
            </button>
          </div>
        </div>

        <Pipeline
          def={def}
          rows={allRows}
          active={statusFilters}
          onToggle={(lane) => {
            const has = statusFilters.includes(lane)
            const next = has
              ? statusFilters.filter((l) => l !== lane)
              : [...statusFilters, lane]
            const f = { ...filters }
            if (next.length === 0) delete f[def.board.field]
            else f[def.board.field] = next
            setFilters(f)
          }}
        />

        {Object.keys(filters).length > 0 && (
          <div className="filter-bar">
            {Object.entries(filters).map(([key, vals]) => {
              const field = def.fields.find((f) => f.key === key)
              if (!field) return null
              return (
                <span key={key} className="filter-chip">
                  <span className="filter-chip-field">{field.label}</span>
                  {vals
                    .map((v) =>
                      chipFor(field, field.kind === 'bool' ? v === 'true' : v).label,
                    )
                    .join(' · ')}
                  <button
                    className="filter-chip-x"
                    aria-label={`Clear ${field.label} filter`}
                    onClick={() => {
                      const f = { ...filters }
                      delete f[key]
                      setFilters(f)
                    }}
                  >
                    <IconClose size={10} />
                  </button>
                </span>
              )
            })}
            <button className="filter-clear" onClick={() => setFilters({})}>
              Clear all
            </button>
          </div>
        )}
      </header>

      {filterOpen && filterBtn.current && (
        <FilterMenu
          def={def}
          observed={observed}
          filters={filters}
          anchor={filterBtn.current}
          onChange={setFilters}
          onClose={() => setFilterOpen(false)}
        />
      )}

      {scriptsStatus === 'error' ? (
        <div className="db-state">
          <p className="db-state-title">Couldn’t load the vault</p>
          <p className="db-state-msg">{scriptsError}</p>
          <button className="btn btn-gold" onClick={() => void loadScripts()}>
            Try again
          </button>
        </div>
      ) : scriptsStatus !== 'ready' ? (
        <div className="db-skeleton" aria-label="Loading">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="skel-row" key={i} style={{ animationDelay: `${i * 90}ms` }} />
          ))}
        </div>
      ) : allRows.length === 0 ? (
        <div className="db-state">
          <p className="db-state-title">No scripts yet</p>
          <p className="db-state-msg">
            Capture the first one — it lands in the vault at{' '}
            <code>{def.pathPrefix}…</code>
          </p>
          <button className="btn btn-gold" onClick={openNewScript}>
            <IconPlus size={13} /> New script
          </button>
        </div>
      ) : (
        <>
          {lens === 'table' && (
            <TableLens
              {...lensProps}
              sort={sort}
              onSort={(key) =>
                setSortPersist(
                  sort.key === key
                    ? { key, dir: sort.dir === 1 ? -1 : 1 }
                    : { key, dir: 1 },
                )
              }
            />
          )}
          {lens === 'board' && <BoardLens {...lensProps} />}
          {lens === 'gallery' && <GalleryLens {...lensProps} />}
        </>
      )}
    </div>
  )
}
