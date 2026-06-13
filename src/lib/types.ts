// Shapes returned by the Parachute Vault HTTP API.
// Timestamps on note objects are camelCase (createdAt/updatedAt); the PATCH
// precondition is the snake_case body field `if_updated_at`.

export type NoteMetadata = Record<string, unknown>

/** A vault link edge (hydrated endpoint summaries omitted — ids suffice). */
export interface VaultLink {
  sourceId: string
  targetId: string
  relationship: string
}

export interface Note {
  id: string
  path: string
  extension?: string
  /** Present when include_content=true (single-note reads, write responses). */
  content?: string
  /** Whitespace-collapsed snippet, present on lean list shapes. */
  preview?: string
  byteSize?: number
  tags: string[]
  metadata: NoteMetadata
  createdAt: string
  updatedAt: string
  /** Echoed by PATCH `if_missing: "create"` responses. */
  created?: boolean
  /** Present when include_links=true. */
  links?: VaultLink[]
  /** Link degree (inbound + outbound), present when include_link_count=true. */
  linkCount?: number
}

export interface TagInfo {
  name: string
  count: number
}

export class VaultError extends Error {
  status: number
  code?: string
  constructor(status: number, message: string, code?: string) {
    super(message)
    this.name = 'VaultError'
    this.status = status
    this.code = code
  }
}

/** 401/403 — the token is missing, expired, or under-scoped. */
export class VaultAuthError extends VaultError {
  constructor(status: number, message: string) {
    super(status, message, 'auth')
    this.name = 'VaultAuthError'
  }
}

/**
 * 409 optimistic-concurrency failure: the note changed after the
 * `if_updated_at` we sent. Carries the live `current_updated_at` so callers
 * can re-read, reconcile, and retry instead of clobbering.
 */
export class VaultConflictError extends VaultError {
  currentUpdatedAt: string | null
  constructor(message: string, currentUpdatedAt: string | null) {
    super(409, message, 'conflict')
    this.name = 'VaultConflictError'
    this.currentUpdatedAt = currentUpdatedAt
  }
}

export type LensKind = 'table' | 'board' | 'gallery'

export type FieldKind = 'enum' | 'bool' | 'text'

export interface EnumOption {
  value: string
  label?: string
  /** Accent key into the chip palette. */
  color: ChipColor
}

export type ChipColor =
  | 'gold'
  | 'red'
  | 'blue'
  | 'green'
  | 'purple'
  | 'neutral'
  | 'dim'

export interface FieldDef {
  key: string
  label: string
  kind: FieldKind
  /**
   * True when the vault maintains a B-tree index for this metadata key.
   * Non-indexed fields (pillar, cta_level) must only ever be sorted/filtered
   * in memory — never via server-side order_by or operator queries.
   */
  indexed: boolean
  options?: EnumOption[]
  /** Sort rank, low → high. Falls back to locale compare when absent. */
  rank?: string[]
  /** Render label for a raw value (bools, dynamic enums). */
  format?: (value: unknown) => string
  /** Chip color for values outside `options` (dynamic enums like pillar). */
  colorOf?: (value: unknown) => ChipColor
  /** Extra values observed in data are offered in editors when true. */
  openEnum?: boolean
}

export interface DatabaseDef {
  key: string
  title: string
  /** Dataset scope: notes whose path starts with this prefix. */
  pathPrefix: string
  fields: FieldDef[]
  tableColumns: string[]
  board: {
    field: string
    lanes: string[]
    /** Lanes rendered dimmed (e.g. idea — live but early). */
    dimLanes: string[]
  }
  gallery: { fields: string[] }
  /** Tags + metadata applied to notes created from this database. */
  newNote: {
    pathPrefix: string
    tags: string[]
    metadata: NoteMetadata
  }
}
