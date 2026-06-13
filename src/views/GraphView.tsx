// Full-screen knowledge graph: the vault as a constellation, verification as
// light. D3 force layout is pre-run to completion, then the galaxy forms —
// nodes fly out from center with the house spring easing, the connective
// tissue fades in, and the gold canon blooms arrive last. After settling, a
// lightweight sine loop drifts every node ±0.3px on an 8s cycle so the
// constellation breathes without re-running the simulation.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceRadial,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
} from 'd3-force'
import { select } from 'd3-selection'
import { zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from 'd3-zoom'
import { fetchGraphNotes } from '../lib/store'
import { navigate } from '../lib/router'
import { titleFromPath } from '../lib/format'
import {
  AXES,
  buildGraph,
  edgeColor,
  isCanon,
  legendFor,
  nodeColor,
  verificationColor,
  LABEL_DEGREE,
  type GraphAxis,
  type GraphData,
  type GraphNode,
} from '../domain/graph'
import { NotePage } from './NotePage'
import { IconBack, IconClose } from '../components/Icons'

const AXIS_KEY = 'atelier.graph.axis'

type Status = 'loading' | 'ready' | 'error'

interface Tooltip {
  x: number
  y: number
  title: string
  tag: string | null
}

/** Run the force layout to rest, synchronously, off-DOM. */
function settle(data: GraphData): void {
  const links: SimulationLinkDatum<GraphNode>[] = data.edges.map((e) => ({
    source: e.source,
    target: e.target,
  }))
  const sim = forceSimulation(data.nodes)
    .force('charge', forceManyBody().strength(-80))
    .force(
      'link',
      forceLink<GraphNode, SimulationLinkDatum<GraphNode>>(links)
        .id((d) => d.id)
        .strength(0.7)
        .distance(46),
    )
    .force('x', forceX<GraphNode>(0).strength((d) => (d.degree === 0 ? 0.12 : 0.05)))
    .force('y', forceY<GraphNode>(0).strength((d) => (d.degree === 0 ? 0.16 : 0.07)))
    .force(
      'collide',
      forceCollide<GraphNode>()
        .radius((d) => d.r + 2)
        .strength(0.6),
    )
    .stop()
  // Phase 1 — let the connected galaxy take shape (alpha < 0.001, same
  // stopping contract as a live simulation).
  for (let i = 0; i < 500 && sim.alpha() > 0.001; i++) sim.tick()

  // Phase 2 — measure the connected mass, then settle the orphans onto a
  // rim just outside it: unformed matter ringing the galaxy.
  const linked = data.nodes.filter((n) => n.degree > 0)
  if (linked.length > 0) {
    const radii = linked.map((n) => Math.hypot(n.x, n.y)).sort((a, b) => a - b)
    const rim = (radii[Math.floor(radii.length * 0.92)] ?? 200) + 55
    sim
      .force(
        'rim',
        forceRadial<GraphNode>(rim).strength((d) => (d.degree === 0 ? 0.55 : 0)),
      )
      .force('x', forceX<GraphNode>(0).strength((d) => (d.degree === 0 ? 0 : 0.05)))
      .force('y', forceY<GraphNode>(0).strength((d) => (d.degree === 0 ? 0 : 0.07)))
      .alpha(0.35)
    for (let i = 0; i < 220 && sim.alpha() > 0.001; i++) sim.tick()
  }
}

function fitTransform(
  nodes: GraphNode[],
  width: number,
  height: number,
): { k: number; x: number; y: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r)
    minY = Math.min(minY, n.y - n.r)
    maxX = Math.max(maxX, n.x + n.r)
    maxY = Math.max(maxY, n.y + n.r)
  }
  if (!Number.isFinite(minX)) return { k: 1, x: width / 2, y: height / 2 }
  const pad = 70
  const bw = maxX - minX + pad * 2
  const bh = maxY - minY + pad * 2
  const k = Math.min(width / bw, height / bh, 1.8)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  return { k, x: width / 2 - k * cx, y: height / 2 - k * cy }
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

export function GraphView() {
  const [status, setStatus] = useState<Status>('loading')
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<GraphData | null>(null)
  const [axis, setAxisState] = useState<GraphAxis>(
    () => (localStorage.getItem(AXIS_KEY) as GraphAxis | null) ?? 'verification',
  )
  const [tooltip, setTooltip] = useState<Tooltip | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [phase, setPhase] = useState<'forming' | 'settled'>('forming')

  const svgRef = useRef<SVGSVGElement>(null)
  const rootRef = useRef<SVGGElement>(null)
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null)
  const driftRaf = useRef(0)
  const userZoomed = useRef(false)

  const setAxis = (a: GraphAxis) => {
    setAxisState(a)
    localStorage.setItem(AXIS_KEY, a)
  }

  // ——— data ———
  const load = useCallback(() => {
    setStatus('loading')
    setError(null)
    fetchGraphNotes()
      .then((notes) => {
        const graph = buildGraph(notes)
        settle(graph)
        setData(graph)
        setStatus('ready')
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // ——— zoom / pan / fit ———
  const applyFit = useCallback((animate: boolean) => {
    const svg = svgRef.current
    const z = zoomRef.current
    if (!svg || !z || !data) return
    const { width, height } = svg.getBoundingClientRect()
    const f = fitTransform(data.nodes, width, height)
    const target = zoomIdentity.translate(f.x, f.y).scale(f.k)
    if (!animate) {
      select(svg).call(z.transform, target)
      return
    }
    const from = zoomTransform(svg)
    const start = performance.now()
    const dur = 450
    const step = (now: number) => {
      const t = easeOutCubic(Math.min(1, (now - start) / dur))
      const k = from.k + (target.k - from.k) * t
      const x = from.x + (target.x - from.x) * t
      const y = from.y + (target.y - from.y) * t
      select(svg).call(z.transform, zoomIdentity.translate(x, y).scale(k))
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [data])

  useEffect(() => {
    if (!data || status !== 'ready') return
    const svg = svgRef.current
    const root = rootRef.current
    if (!svg || !root) return

    const z = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 7])
      .clickDistance(5)
      .on('zoom', (e) => {
        if (e.sourceEvent) userZoomed.current = true
        root.setAttribute('transform', e.transform.toString())
        setTooltip(null)
      })
    zoomRef.current = z
    const sel = select(svg)
    sel.call(z)
    sel.on('dblclick.zoom', null) // double-click = reset-to-fit, not zoom-in
    applyFit(false)

    const onResize = () => {
      if (!userZoomed.current) applyFit(false)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      sel.on('.zoom', null)
    }
  }, [data, status, applyFit])

  // ——— the galaxy forms: center → settled positions, then breathe ———
  useEffect(() => {
    if (!data || status !== 'ready') return
    const els = nodeEls.current
    // Start: everything collapsed at the canvas center, invisible.
    for (const n of data.nodes) {
      const el = els.get(n.id)
      if (!el) continue
      el.style.transition = 'none'
      el.setAttribute('transform', 'translate(0,0)')
      el.style.opacity = '0'
    }
    // Force a style flush so the spread actually transitions.
    void svgRef.current?.getBoundingClientRect()
    const spread = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        for (const n of data.nodes) {
          const el = els.get(n.id)
          if (!el) continue
          el.style.transition =
            'transform 1.5s var(--ease-spring), opacity 0.9s ease'
          el.setAttribute('transform', `translate(${n.x},${n.y})`)
          el.style.opacity = '1'
        }
      })
    })

    // After settling: drop transitions, start the micro-drift loop.
    const settleTimer = setTimeout(() => {
      setPhase('settled')
      for (const n of data.nodes) {
        const el = els.get(n.id)
        if (el) el.style.transition = 'none'
      }
      const t0 = performance.now()
      const drift = (now: number) => {
        const t = ((now - t0) / 8000) * Math.PI * 2 // 8-second cycle
        for (const n of data.nodes) {
          const el = els.get(n.id)
          if (!el) continue
          const dx = 0.3 * Math.sin(t + n.phase)
          const dy = 0.3 * Math.cos(t + n.phase * 1.7)
          el.setAttribute('transform', `translate(${n.x + dx},${n.y + dy})`)
        }
        driftRaf.current = requestAnimationFrame(drift)
      }
      driftRaf.current = requestAnimationFrame(drift)
    }, 1600)

    return () => {
      cancelAnimationFrame(spread)
      clearTimeout(settleTimer)
      cancelAnimationFrame(driftRaf.current)
    }
  }, [data, status])

  // ——— escape closes the drawer, then leaves the graph alone ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selected) {
        e.stopPropagation()
        setSelected(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected])

  const goBack = () => {
    if (window.history.length > 1) window.history.back()
    else navigate({ kind: 'scripts' })
  }

  const hover = (n: GraphNode, e: React.PointerEvent) => {
    setTooltip({
      x: e.clientX,
      y: e.clientY,
      title: titleFromPath(n.path),
      tag: n.tags[0] ?? null,
    })
  }

  const legend = useMemo(() => legendFor(axis), [axis])

  const nodeById = useMemo(
    () => new Map((data?.nodes ?? []).map((n) => [n.id, n])),
    [data],
  )

  // Layers are memoized so tooltip/drawer state changes never reconcile the
  // 285-node / 656-edge SVG tree.
  const edgesLayer = useMemo(() => {
    if (!data) return null
    return (
      <g className={`graph-edges${phase === 'settled' ? ' is-on' : ''}`}>
        {data.edges.map((e, i) => {
          const s = nodeById.get(e.source)
          const t = nodeById.get(e.target)
          if (!s || !t) return null
          return (
            <line
              key={i}
              x1={s.x}
              y1={s.y}
              x2={t.x}
              y2={t.y}
              stroke={edgeColor(e.relationship)}
              strokeWidth={1}
              // hairlines stay hairlines at every zoom level
              vectorEffect="non-scaling-stroke"
            />
          )
        })}
      </g>
    )
  }, [data, nodeById, phase])

  const nodesLayer = useMemo(() => {
    if (!data) return null
    return (
      <g className="graph-nodes">
        {data.nodes.map((n) => {
          const c = nodeColor(n, axis)
          const v = verificationColor(n.verification)
          const canon = isCanon(n)
          return (
            <g
              key={n.id}
              ref={(el) => {
                if (el) nodeEls.current.set(n.id, el)
                else nodeEls.current.delete(n.id)
              }}
              className="gnode"
              data-path={n.path}
              data-degree={n.degree}
              data-canon={canon || undefined}
              onPointerEnter={(e) => hover(n, e)}
              onPointerLeave={() => setTooltip(null)}
              onClick={() => setSelected(n.path)}
            >
              {canon && (
                <circle
                  className={`gnode-bloom${phase === 'settled' ? ' is-on' : ''}`}
                  r={n.r + 7}
                  fill="#C4923A"
                  filter="url(#canon-bloom)"
                />
              )}
              <circle className="gnode-core" r={n.r} fill={c.fill} fillOpacity={c.opacity} />
              {axis !== 'verification' && (
                <circle
                  className="gnode-ring"
                  r={n.r + 1.8}
                  fill="none"
                  stroke={v.fill}
                  strokeOpacity={v.opacity * 0.9}
                  strokeWidth={0.75}
                />
              )}
              {n.degree >= LABEL_DEGREE && (
                <text className="gnode-label" y={-(n.r + 7)}>
                  {titleFromPath(n.path)}
                </text>
              )}
              {/* generous invisible hit area for small faint nodes */}
              <circle r={Math.max(n.r + 4, 8)} fill="transparent" />
            </g>
          )
        })}
      </g>
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, axis, phase])

  return (
    <div className="graph-stage" data-testid="graph-stage">
      <svg ref={svgRef} className="graph-svg" data-testid="graph-svg">
        <defs>
          {/* the canon bloom — soft gold halo */}
          <filter id="canon-bloom" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        {/* double-click empty space resets to fit (underneath the nodes) */}
        <rect
          className="graph-dblclick-catcher"
          width="100%"
          height="100%"
          fill="transparent"
          onDoubleClick={() => {
            userZoomed.current = false
            applyFit(true)
          }}
          style={{ pointerEvents: status === 'ready' ? undefined : 'none' }}
        />
        {data && status === 'ready' && (
          <g ref={rootRef}>
            {edgesLayer}
            {nodesLayer}
          </g>
        )}
      </svg>

      {/* top-left: back + wordmark */}
      <div className="graph-topbar">
        <button className="graph-back" onClick={goBack} aria-label="Back" data-testid="graph-back">
          <IconBack size={15} />
        </button>
        <span className="graph-wordmark">
          <svg width="13" height="13" viewBox="0 0 32 32" aria-hidden="true">
            <path d="M16 4.5 27.5 16 16 27.5 4.5 16Z" fill="none" stroke="var(--gold)" strokeWidth="2.6" />
            <circle cx="16" cy="16" r="3" fill="var(--gold)" />
          </svg>
          Atelier
        </span>
      </div>

      {/* top-right: axis switcher */}
      <div className="graph-axes" role="tablist" aria-label="Color axis" data-testid="graph-axes">
        <i
          className="graph-axes-thumb"
          style={{ transform: `translateX(${AXES.findIndex((a) => a.key === axis) * 100}%)` }}
          aria-hidden="true"
        />
        {AXES.map((a) => (
          <button
            key={a.key}
            role="tab"
            aria-selected={axis === a.key}
            className={`graph-axis-btn${axis === a.key ? ' is-active' : ''}`}
            onClick={() => setAxis(a.key)}
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* bottom-left: legend for the active axis */}
      {status === 'ready' && (
        <div className="graph-legend" data-testid="graph-legend">
          {legend.map((row) => (
            <span key={row.label} className="graph-legend-row">
              <i
                className="graph-legend-dot"
                style={{ background: row.color.fill, opacity: row.color.opacity }}
              />
              {row.label}
            </span>
          ))}
        </div>
      )}

      {/* bottom-right: the real numbers */}
      {data && status === 'ready' && (
        <div className="graph-stats" data-testid="graph-stats">
          {data.nodes.length} notes · {data.edges.length} links
        </div>
      )}

      {status === 'loading' && (
        <div className="graph-loading" data-testid="graph-loading">
          <span className="graph-pulse">
            <i className="graph-pulse-core" />
            <i className="graph-pulse-ring" />
            <i className="graph-pulse-ring r2" />
          </span>
          Loading vault…
        </div>
      )}

      {status === 'error' && (
        <div className="graph-loading">
          <p className="db-state-msg">{error}</p>
          <button className="btn btn-gold" onClick={load}>
            Try again
          </button>
        </div>
      )}

      {tooltip && !selected && (
        <div
          className="graph-tooltip"
          style={{
            left: Math.min(tooltip.x + 14, window.innerWidth - 240),
            top: Math.min(tooltip.y + 14, window.innerHeight - 70),
          }}
        >
          <span className="graph-tooltip-title">{tooltip.title}</span>
          {tooltip.tag && <span className="graph-tooltip-tag">#{tooltip.tag}</span>}
        </div>
      )}

      {selected && (
        <>
          <div className="graph-drawer-backdrop" onClick={() => setSelected(null)} />
          <aside className="graph-drawer" data-testid="graph-drawer">
            <button
              className="graph-drawer-close"
              aria-label="Close note"
              onClick={() => setSelected(null)}
            >
              <IconClose size={14} />
            </button>
            <NotePage path={selected} key={selected} />
          </aside>
        </>
      )}
    </div>
  )
}
