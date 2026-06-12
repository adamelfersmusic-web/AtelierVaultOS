// The Scripts database definition — content/scripts rendered as one dataset.
//
// Metadata is the source of truth for every chip. Script bodies often carry a
// stale `**Status:** …` header line from an earlier era: it is never parsed,
// never reconciled, and never rewritten by this app.
//
// Indexed fields (status, conviction, recorded, published, source, declined,
// approval_required, voice, verification) are safe to query server-side.
// pillar and cta_level are NOT vault-indexed: they are sorted and filtered in
// memory only — never via server-side order_by or operator queries.

import type { ChipColor, DatabaseDef, FieldDef, Note } from '../lib/types'

export const STATUS_LANES = [
  'idea',
  'draft',
  'approved',
  'filmed',
  'edited',
  'published',
] as const

const STATUS_COLORS: Record<string, ChipColor> = {
  idea: 'dim',
  draft: 'blue',
  approved: 'gold',
  filmed: 'red',
  edited: 'purple',
  published: 'green',
}

const PILLAR_COLORS: Record<string, ChipColor> = {
  presence: 'gold',
  ownership: 'purple',
  income: 'green',
  integrity: 'blue',
  protection: 'red',
}

function pillarColor(value: unknown): ChipColor {
  const head = String(value ?? '').split('/')[0] ?? ''
  return PILLAR_COLORS[head] ?? 'neutral'
}

const yesNo = (yes: ChipColor): FieldDef['options'] => [
  { value: 'no', color: 'dim' },
  { value: 'yes', color: yes },
]

export const FIELDS: FieldDef[] = [
  {
    key: 'status',
    label: 'Status',
    kind: 'enum',
    indexed: true,
    rank: [...STATUS_LANES],
    options: STATUS_LANES.map((value) => ({
      value,
      color: STATUS_COLORS[value] ?? 'neutral',
    })),
    openEnum: true,
    colorOf: (v) => STATUS_COLORS[String(v)] ?? 'neutral',
  },
  {
    key: 'conviction',
    label: 'Conviction',
    kind: 'enum',
    indexed: true,
    rank: ['maybe', 'strong', 'killer'],
    options: [
      { value: 'maybe', color: 'dim' },
      { value: 'strong', color: 'blue' },
      { value: 'killer', color: 'red' },
    ],
  },
  {
    key: 'pillar',
    label: 'Pillar',
    kind: 'enum',
    indexed: false, // in-memory sort/filter only — never server-side
    options: Object.keys(PILLAR_COLORS).map((value) => ({
      value,
      color: PILLAR_COLORS[value]!,
    })),
    openEnum: true,
    colorOf: pillarColor,
  },
  {
    key: 'voice',
    label: 'Voice',
    kind: 'enum',
    indexed: true,
    options: [
      { value: 'founder', color: 'gold' },
      { value: 'operator', color: 'blue' },
      { value: 'canon', color: 'purple' },
    ],
  },
  {
    key: 'source',
    label: 'Source',
    kind: 'enum',
    indexed: true,
    options: [
      { value: 'california', color: 'gold' },
      { value: 'gpt', color: 'purple' },
      { value: 'va', color: 'blue' },
      { value: 'email', color: 'neutral' },
      { value: 'interview', color: 'red' },
      { value: 'brainstorm', color: 'green' },
      { value: 'founder-voice', color: 'gold' },
    ],
  },
  {
    key: 'verification',
    label: 'Verification',
    kind: 'enum',
    indexed: true,
    rank: ['UNVERIFIED', 'ANALYSIS-VERIFIED', 'VERIFIED', 'VERIFIED-CANON'],
    options: [
      { value: 'UNVERIFIED', label: 'unverified', color: 'dim' },
      { value: 'ANALYSIS-VERIFIED', label: 'analysis-verified', color: 'blue' },
      { value: 'VERIFIED', label: 'verified', color: 'green' },
      { value: 'VERIFIED-CANON', label: 'verified-canon', color: 'purple' },
    ],
  },
  {
    key: 'recorded',
    label: 'Recorded',
    kind: 'enum',
    indexed: true,
    rank: ['no', 'yes'],
    options: yesNo('green'),
  },
  {
    key: 'published',
    label: 'Published',
    kind: 'enum',
    indexed: true,
    rank: ['no', 'yes'],
    options: yesNo('green'),
  },
  {
    key: 'cta_level',
    label: 'CTA',
    kind: 'enum',
    indexed: false, // in-memory sort/filter only — never server-side
    rank: ['0', '1', '2', '3'],
    options: [
      { value: '0', label: 'CTA 0', color: 'dim' },
      { value: '1', label: 'CTA 1', color: 'blue' },
      { value: '2', label: 'CTA 2', color: 'gold' },
      { value: '3', label: 'CTA 3', color: 'red' },
    ],
    format: (v) => `CTA ${String(v)}`,
  },
  {
    key: 'declined',
    label: 'Declined',
    kind: 'bool',
    indexed: true,
    options: [
      { value: 'false', label: '—', color: 'dim' },
      { value: 'true', label: 'declined', color: 'red' },
    ],
  },
  {
    key: 'approval_required',
    label: 'Approval',
    kind: 'bool',
    indexed: true,
    options: [
      { value: 'false', label: '—', color: 'dim' },
      { value: 'true', label: 'hold', color: 'gold' },
    ],
  },
]

export const SCRIPTS_DB: DatabaseDef = {
  key: 'scripts',
  title: 'Scripts',
  pathPrefix: 'content/scripts/',
  fields: FIELDS,
  tableColumns: [
    'status',
    'conviction',
    'pillar',
    'voice',
    'source',
    'verification',
    'recorded',
    'published',
    'cta_level',
  ],
  board: {
    field: 'status',
    lanes: [...STATUS_LANES],
    dimLanes: ['idea'],
  },
  gallery: { fields: ['status', 'pillar', 'conviction'] },
  newNote: {
    pathPrefix: 'content/scripts/',
    tags: ['content/script', 'type/content'],
    metadata: {
      status: 'idea',
      recorded: 'no',
      published: 'no',
      cta_level: '0',
      declined: false,
      approval_required: false,
      voice: 'operator',
    },
  },
}

export function fieldByKey(key: string): FieldDef | undefined {
  return FIELDS.find((f) => f.key === key)
}

export function isScriptNote(note: Note): boolean {
  return (
    note.path.startsWith(SCRIPTS_DB.pathPrefix) ||
    note.tags.includes('content/script')
  )
}

/**
 * The two-tier Raw Layer Principle: founder canon — transcripts, do-not-alter
 * notes, locked brand docs, canon-voiced notes — is never silently
 * auto-written. The UI has no auto-writes at all; on top of that, body edits
 * to these notes require an explicit human confirmation before saving.
 */
const PROTECTED_TAGS = ['do-not-alter', 'transcript', 'brand-brain']

export function isProtectedNote(note: Note): boolean {
  return (
    note.tags.some((t) => PROTECTED_TAGS.includes(t)) ||
    note.metadata['voice'] === 'canon'
  )
}

export function protectionReason(note: Note): string {
  if (note.tags.includes('do-not-alter')) return 'do-not-alter'
  if (note.tags.includes('transcript')) return 'transcript'
  if (note.tags.includes('brand-brain')) return 'brand canon'
  if (note.metadata['voice'] === 'canon') return 'canon voice'
  return 'protected'
}
