import { useMemo, useRef, useState } from 'react'
import type { Note } from '../lib/types'
import { isProtectedNote } from '../domain/scripts'
import { chipFor } from '../components/Chip'
import { IconShield } from '../components/Icons'
import { filterValueOf, rankOf, type LensProps, type Row } from './DatabaseView'

const UNSET = '·unset'

interface DragState {
  path: string
  from: string
  card: HTMLElement
  ghost: HTMLElement
  offsetX: number
  offsetY: number
  started: boolean
  startX: number
  startY: number
}

export function BoardLens({ def, rows, onOpen, setField, saving }: LensProps) {
  const statusField = def.fields.find((f) => f.key === def.board.field)!
  const convictionField = def.fields.find((f) => f.key === 'conviction')
  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [hoverLane, setHoverLane] = useState<string | null>(null)
  const [draggingPath, setDraggingPath] = useState<string | null>(null)

  const lanes = useMemo(() => {
    const known = new Set(def.board.lanes)
    const extras = new Set<string>()
    let hasUnset = false
    for (const r of rows) {
      const v = filterValueOf(statusField, r.note)
      if (!v) hasUnset = true
      else if (!known.has(v)) extras.add(v)
    }
    return [
      ...def.board.lanes,
      ...[...extras].sort(),
      ...(hasUnset ? [UNSET] : []),
    ]
  }, [rows, def.board.lanes, statusField])

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>()
    for (const lane of lanes) map.set(lane, [])
    for (const r of rows) {
      const v = filterValueOf(statusField, r.note) || UNSET
      map.get(v)?.push(r)
    }
    // Within a lane: conviction (killer first), then recency.
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (convictionField) {
          const ra = rankOf(convictionField, filterValueOf(convictionField, a.note))
          const rb = rankOf(convictionField, filterValueOf(convictionField, b.note))
          if (ra !== rb) return rb - ra
        }
        return a.note.updatedAt < b.note.updatedAt ? 1 : -1
      })
    }
    return map
  }, [rows, lanes, statusField, convictionField])

  const cleanup = () => {
    const d = dragRef.current
    if (d) {
      d.ghost.remove()
      d.card.classList.remove('is-drag-source')
      document.body.classList.remove('is-dragging')
    }
    dragRef.current = null
    setHoverLane(null)
    setDraggingPath(null)
  }

  const laneAt = (x: number, y: number): string | null => {
    const board = boardRef.current
    if (!board) return null
    for (const el of board.querySelectorAll<HTMLElement>('[data-lane]')) {
      const r = el.getBoundingClientRect()
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        return el.dataset.lane ?? null
      }
    }
    return null
  }

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>, row: Row, lane: string) => {
    if (e.button !== 0) return
    const card = e.currentTarget
    card.setPointerCapture(e.pointerId)
    const rect = card.getBoundingClientRect()
    const ghost = card.cloneNode(true) as HTMLElement
    ghost.classList.add('card-ghost')
    ghost.style.width = `${rect.width}px`
    dragRef.current = {
      path: row.path,
      from: lane,
      card,
      ghost,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
      started: false,
      startX: e.clientX,
      startY: e.clientY,
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.started) {
      if (Math.hypot(dx, dy) < 6) return
      d.started = true
      document.body.appendChild(d.ghost)
      d.card.classList.add('is-drag-source')
      document.body.classList.add('is-dragging')
      setDraggingPath(d.path)
    }
    d.ghost.style.left = `${e.clientX - d.offsetX}px`
    d.ghost.style.top = `${e.clientY - d.offsetY}px`
    setHoverLane(laneAt(e.clientX, e.clientY))
  }

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current
    if (!d) return
    if (!d.started) {
      cleanup()
      onOpen(d.path)
      return
    }
    const target = laneAt(e.clientX, e.clientY)
    cleanup()
    if (target && target !== d.from && target !== UNSET) {
      const prev = d.from === UNSET ? null : d.from
      setField(d.path, def.board.field, target, prev)
    }
  }

  const onPointerCancel = () => cleanup()

  return (
    <div className="board" ref={boardRef}>
      {lanes.map((lane) => {
        const list = grouped.get(lane) ?? []
        const isDim = def.board.dimLanes.includes(lane) || lane === UNSET
        const chip = lane === UNSET ? null : chipFor(statusField, lane)
        return (
          <section
            key={lane}
            data-lane={lane}
            className={`lane${isDim ? ' lane-dim' : ''}${hoverLane === lane ? ' lane-hover' : ''}`}
          >
            <header className="lane-head">
              <i className={`lane-dot dot-${chip?.color ?? 'dim'}`} />
              <span className="lane-name">{lane === UNSET ? 'no status' : lane}</span>
              <span className="lane-count">{list.length}</span>
            </header>
            <div className="lane-cards">
              {list.map((row) => (
                <BoardCard
                  key={row.path}
                  row={row}
                  lane={lane}
                  def={def}
                  saving={(saving[row.path] ?? 0) > 0}
                  dragging={draggingPath === row.path}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerCancel}
                />
              ))}
              {list.length === 0 && <div className="lane-empty" />}
            </div>
          </section>
        )
      })}
    </div>
  )
}

function BoardCard({
  row,
  lane,
  def,
  saving,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  row: Row
  lane: string
  def: LensProps['def']
  saving: boolean
  dragging: boolean
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, row: Row, lane: string) => void
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void
  onPointerCancel: () => void
}) {
  const note: Note = row.note
  const conviction = note.metadata['conviction']
  const pillar = note.metadata['pillar']
  const hold = note.metadata['approval_required'] === true
  const declined = note.metadata['declined'] === true
  const convictionField = def.fields.find((f) => f.key === 'conviction')
  const pillarField = def.fields.find((f) => f.key === 'pillar')

  return (
    <div
      className={`card${saving ? ' is-saving' : ''}${dragging ? ' is-drag-source' : ''}`}
      data-path={row.path}
      role="button"
      tabIndex={0}
      onPointerDown={(e) => onPointerDown(e, row, lane)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          window.location.hash = `#/note/${row.path.split('/').map(encodeURIComponent).join('/')}`
        }
      }}
    >
      <div className="card-title">
        {row.title}
        {isProtectedNote(note) && (
          <span className="canon-mini" title="Founder canon — human-gated">
            <IconShield size={10} />
          </span>
        )}
      </div>
      <div className="card-meta">
        {conviction != null && convictionField ? (
          <span
            className={`conviction conviction-${String(conviction)}`}
            title={`conviction: ${String(conviction)}`}
          >
            {String(conviction) === 'killer' ? '◆◆◆' : String(conviction) === 'strong' ? '◆◆' : '◆'}
          </span>
        ) : null}
        {pillar != null && pillarField ? (
          <span className={`card-pillar pill-${chipFor(pillarField, pillar).color}`}>
            {String(pillar)}
          </span>
        ) : null}
        <span className="card-spacer" />
        {declined && <span className="card-flag flag-red">declined</span>}
        {hold && <span className="card-flag flag-gold">hold</span>}
      </div>
    </div>
  )
}
