// The knowledge-graph domain model: verification as light.
//
// Color mappings are grounded in the REAL vault data (285 notes, 656 edges,
// pulled 2026-06-13): 9 VERIFIED-CANON notes carry the gold bloom; 106
// VERIFIED; 127 ANALYSIS-VERIFIED; everything else — UNVERIFIED, RAW,
// NEEDS-JONATHAN-VERIFY, unstamped — renders as the faint not-yet-condensed
// tier. Edge provenance in the live vault is a whole family of spellings
// (source_of, sourced-from, derived_from, compiled-from, condensed_from…),
// so provenance gold matches the normalized family, not just two literals.

import type { Note } from '../lib/types'

export type GraphAxis = 'verification' | 'domain' | 'type' | 'lifecycle'

export const AXES: { key: GraphAxis; label: string }[] = [
  { key: 'verification', label: 'Verification' },
  { key: 'domain', label: 'Domain' },
  { key: 'type', label: 'Type' },
  { key: 'lifecycle', label: 'Lifecycle' },
]

export interface GraphNode {
  id: string
  path: string
  tags: string[]
  verification: string | null
  degree: number
  /** Layout position (filled by the simulation). */
  x: number
  y: number
  /** Render radius, 3–14px from real degree. */
  r: number
  /** Micro-drift phase so the constellation never feels frozen. */
  phase: number
}

export interface GraphEdge {
  source: string
  target: string
  relationship: string
}

export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

// --- node sizing (real degrees run 0…38; sqrt keeps hubs gravitational
// without swallowing the canvas) -------------------------------------------

export function radiusFor(degree: number, maxDegree: number): number {
  const d = Math.max(0, degree)
  const max = Math.max(1, maxDegree)
  return 3 + 11 * Math.sqrt(d / max)
}

/** Hub labels only — degree ≥ 8 (56 of the 285 real notes). */
export const LABEL_DEGREE = 8

// --- verification: the luminosity ladder ------------------------------------

export interface NodeColor {
  fill: string
  opacity: number
}

const VERIFICATION_LIGHT: Record<string, NodeColor> = {
  'VERIFIED-CANON': { fill: '#f3e4be', opacity: 1 }, // bright, gold-warmed — blooms
  VERIFIED: { fill: '#ece5d8', opacity: 1 }, // clear warm ivory
  'ANALYSIS-VERIFIED': { fill: '#c3c9d0', opacity: 0.65 }, // dimmer, cooler
}

const FAINT: NodeColor = { fill: '#b8b2a6', opacity: 0.3 } // not yet condensed

export function verificationColor(v: string | null): NodeColor {
  return (v && VERIFICATION_LIGHT[v]) || FAINT
}

export function isCanon(node: Pick<GraphNode, 'verification'>): boolean {
  return node.verification === 'VERIFIED-CANON'
}

// --- the other three axes (chip semantics from domain/scripts.ts) ------------

const GOLD = '#C4923A'
const RED = '#C4445A'
const BLUE = '#4A7FA5'
const GREEN = '#4A8C5C'
const PURPLE = '#7A5C9E'
const DIM: NodeColor = { fill: '#b8b2a6', opacity: 0.25 }
const NEUTRAL: NodeColor = { fill: '#8a8071', opacity: 0.5 }

function domainColor(tags: string[]): NodeColor {
  if (tags.includes('domain/sales')) return { fill: GOLD, opacity: 1 }
  if (tags.includes('domain/recruiting')) return { fill: BLUE, opacity: 1 }
  if (tags.includes('domain/content')) return { fill: GREEN, opacity: 1 }
  if (tags.includes('domain/ai')) return { fill: PURPLE, opacity: 1 }
  if (tags.includes('domain/analytics')) return { fill: RED, opacity: 1 }
  return DIM
}

function typeColor(tags: string[]): NodeColor {
  if (tags.includes('brand-brain') || tags.includes('soul')) return { fill: GOLD, opacity: 1 }
  if (tags.includes('content/script')) return { fill: RED, opacity: 1 }
  if (tags.includes('intel') || tags.includes('strategy')) return { fill: BLUE, opacity: 1 }
  if (tags.includes('system-note') || tags.includes('ops')) return { fill: PURPLE, opacity: 1 }
  if (tags.some((t) => t === 'people' || t.startsWith('people/'))) return { fill: GREEN, opacity: 1 }
  return DIM
}

function lifecycleColor(tags: string[]): NodeColor {
  if (tags.includes('canon-candidate')) return { fill: '#f0e9da', opacity: 1 } // bright ivory
  if (tags.includes('pinned')) return { fill: GOLD, opacity: 1 }
  if (tags.includes('superseded')) return { fill: RED, opacity: 0.4 }
  if (tags.includes('todo')) return { fill: BLUE, opacity: 0.55 }
  return NEUTRAL
}

export function nodeColor(node: GraphNode, axis: GraphAxis): NodeColor {
  switch (axis) {
    case 'verification':
      return verificationColor(node.verification)
    case 'domain':
      return domainColor(node.tags)
    case 'type':
      return typeColor(node.tags)
    case 'lifecycle':
      return lifecycleColor(node.tags)
  }
}

/** Legend rows for the active axis (drawn from the same mappings). */
export function legendFor(axis: GraphAxis): { label: string; color: NodeColor }[] {
  switch (axis) {
    case 'verification':
      return [
        { label: 'verified-canon', color: VERIFICATION_LIGHT['VERIFIED-CANON']! },
        { label: 'verified', color: VERIFICATION_LIGHT['VERIFIED']! },
        { label: 'analysis-verified', color: VERIFICATION_LIGHT['ANALYSIS-VERIFIED']! },
        { label: 'unverified', color: FAINT },
      ]
    case 'domain':
      return [
        { label: 'sales', color: { fill: GOLD, opacity: 1 } },
        { label: 'recruiting', color: { fill: BLUE, opacity: 1 } },
        { label: 'content', color: { fill: GREEN, opacity: 1 } },
        { label: 'ai', color: { fill: PURPLE, opacity: 1 } },
        { label: 'analytics', color: { fill: RED, opacity: 1 } },
        { label: 'other', color: DIM },
      ]
    case 'type':
      return [
        { label: 'brand · soul', color: { fill: GOLD, opacity: 1 } },
        { label: 'scripts', color: { fill: RED, opacity: 1 } },
        { label: 'intel · strategy', color: { fill: BLUE, opacity: 1 } },
        { label: 'system · ops', color: { fill: PURPLE, opacity: 1 } },
        { label: 'people', color: { fill: GREEN, opacity: 1 } },
        { label: 'other', color: DIM },
      ]
    case 'lifecycle':
      return [
        { label: 'canon-candidate', color: { fill: '#f0e9da', opacity: 1 } },
        { label: 'pinned', color: { fill: GOLD, opacity: 1 } },
        { label: 'superseded', color: { fill: RED, opacity: 0.4 } },
        { label: 'todo', color: { fill: BLUE, opacity: 0.55 } },
        { label: 'other', color: NEUTRAL },
      ]
  }
}

// --- edges -------------------------------------------------------------------

const EDGE_NEUTRAL = 'rgba(255,255,255,0.06)'
const EDGE_GOLD = 'rgba(196,146,58,0.15)'
const EDGE_RED = 'rgba(196,68,90,0.12)'

/** The provenance family as it actually appears in the vault. */
const PROVENANCE = new Set([
  'source_of',
  'source_for',
  'sourced_from',
  'derived_from',
  'compiled_from',
  'condensed_from',
  'originated_from',
])

export function edgeColor(relationship: string): string {
  const rel = relationship.toLowerCase().replace(/-/g, '_')
  if (rel === 'supersedes') return EDGE_RED
  if (PROVENANCE.has(rel)) return EDGE_GOLD
  return EDGE_NEUTRAL
}

// --- builder -----------------------------------------------------------------

/** Build the graph from the vault response: dedupe edges (each appears in
 * both endpoints' lists), drop edges pointing outside the node set. */
export function buildGraph(notes: Note[]): GraphData {
  const byId = new Map(notes.map((n) => [n.id, n]))
  const maxDegree = Math.max(1, ...notes.map((n) => n.linkCount ?? 0))
  const nodes: GraphNode[] = notes.map((n, i) => {
    // Defensive: the live vault can return a note with no `metadata` object
    // at all (and, in principle, no `tags`/`path`). The lean Note type says
    // these are always present, but real responses don't always honor that —
    // reading `n.metadata['verification']` off an undefined metadata was the
    // graph-load crash. Normalize once here so every downstream consumer
    // (color axes, tooltip, labels) sees well-formed values.
    const meta = n.metadata ?? {}
    const tags = n.tags ?? []
    const v = meta['verification']
    return {
      id: n.id,
      path: n.path ?? n.id,
      tags,
      // No stamp → null, which renders as the faint "unverified" tier
      // (verificationColor maps both null and "UNVERIFIED" to the same light).
      verification: typeof v === 'string' && v ? v : null,
      degree: n.linkCount ?? 0,
      x: 0,
      y: 0,
      r: radiusFor(n.linkCount ?? 0, maxDegree),
      phase: (i * 137.5 * Math.PI) / 180, // golden-angle phases for the drift
    }
  })

  const seen = new Set<string>()
  const edges: GraphEdge[] = []
  for (const n of notes) {
    for (const l of n.links ?? []) {
      if (!l || !byId.has(l.sourceId) || !byId.has(l.targetId)) continue
      const key = `${l.sourceId}→${l.targetId}→${l.relationship}`
      if (seen.has(key)) continue
      seen.add(key)
      edges.push({ source: l.sourceId, target: l.targetId, relationship: l.relationship })
    }
  }
  return { nodes, edges }
}
