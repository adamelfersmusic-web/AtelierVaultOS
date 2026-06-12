// Global session store: vault connection, note cache, write pipeline.
//
// Every write is human-initiated and goes through optimistic concurrency:
// the note's last-known updatedAt rides along as if_updated_at, and a 409
// triggers reload → reconcile → retry instead of clobbering. Writes to the
// same note are serialized so rapid edits can't race each other's
// preconditions.

import { useSyncExternalStore } from 'react'
import { VaultApi } from './api'
import { slugify } from './format'
import {
  VaultAuthError,
  VaultConflictError,
  type Note,
  type NoteMetadata,
  type TagInfo,
  type VaultConfig,
} from './types'
import { SCRIPTS_DB } from '../domain/scripts'

const CONFIG_KEY = 'atelier.vault'

export type ConnectionState = 'idle' | 'ok' | 'auth-error'

export interface ToastItem {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
  action?: { label: string; run: () => void }
}

export interface StoreState {
  config: VaultConfig | null
  connection: ConnectionState
  /** Note cache keyed by vault path. */
  notes: Record<string, Note>
  /** Paths of the scripts dataset, in vault order. */
  scripts: string[] | null
  scriptsStatus: 'idle' | 'loading' | 'ready' | 'error'
  scriptsError: string | null
  tags: TagInfo[]
  toasts: ToastItem[]
  /** Paths with an in-flight write (drives the saving pulse). */
  saving: Record<string, number>
}

/** Content diverged during a body edit — needs a human decision. */
export class ContentDivergedError extends Error {
  fresh: Note
  constructor(fresh: Note) {
    super('Note content changed in the vault while you were editing.')
    this.name = 'ContentDivergedError'
    this.fresh = fresh
  }
}

function loadConfig(): VaultConfig | null {
  try {
    const raw = localStorage.getItem(CONFIG_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (typeof parsed?.url === 'string' && typeof parsed?.token === 'string') {
      return { url: parsed.url, token: parsed.token }
    }
  } catch {
    /* corrupted config — treat as signed out */
  }
  return null
}

let api: VaultApi | null = null
let state: StoreState = {
  config: null,
  connection: 'idle',
  notes: {},
  scripts: null,
  scriptsStatus: 'idle',
  scriptsError: null,
  tags: [],
  toasts: [],
  saving: {},
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

function set(partial: Partial<StoreState>): void {
  state = { ...state, ...partial }
  emit()
}

export function getState(): StoreState {
  return state
}

export function useStore(): StoreState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

function requireApi(): VaultApi {
  if (!api) throw new Error('Vault is not connected')
  return api
}

function handleAuthFailure(e: unknown): void {
  if (e instanceof VaultAuthError) set({ connection: 'auth-error' })
}

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------

let toastSeq = 1

export function toast(
  kind: ToastItem['kind'],
  text: string,
  action?: ToastItem['action'],
): void {
  const item: ToastItem = { id: toastSeq++, kind, text, action }
  set({ toasts: [...state.toasts, item].slice(-4) })
}

export function dismissToast(id: number): void {
  set({ toasts: state.toasts.filter((t) => t.id !== id) })
}

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export function init(): void {
  const config = loadConfig()
  if (!config) return
  api = new VaultApi(config)
  set({ config, connection: 'ok' })
  void loadScripts()
  void loadTags()
}

export async function connect(url: string, token: string): Promise<void> {
  const cfg: VaultConfig = { url: url.replace(/\/+$/, ''), token: token.trim() }
  const probe = new VaultApi(cfg)
  await probe.ping() // throws with a precise message on failure
  api = probe
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg))
  set({ config: cfg, connection: 'ok', scriptsStatus: 'idle', notes: {} })
  void loadScripts()
  void loadTags()
}

export function disconnect(): void {
  localStorage.removeItem(CONFIG_KEY)
  api = null
  set({
    config: null,
    connection: 'idle',
    notes: {},
    scripts: null,
    scriptsStatus: 'idle',
    scriptsError: null,
    tags: [],
  })
}

// ---------------------------------------------------------------------------
// Note cache
// ---------------------------------------------------------------------------

/** Merge a server note into the cache, preserving cached content when the
 * incoming shape is lean and the note hasn't moved on. */
function mergeNote(incoming: Note): Note {
  const prev = state.notes[incoming.path]
  let next = incoming
  if (
    prev?.content !== undefined &&
    incoming.content === undefined &&
    prev.updatedAt === incoming.updatedAt
  ) {
    next = { ...incoming, content: prev.content }
  }
  state = { ...state, notes: { ...state.notes, [incoming.path]: next } }
  emit()
  return next
}

function mergeNotes(incoming: Note[]): void {
  const notes = { ...state.notes }
  for (const n of incoming) {
    const prev = notes[n.path]
    notes[n.path] =
      prev?.content !== undefined &&
      n.content === undefined &&
      prev.updatedAt === n.updatedAt
        ? { ...n, content: prev.content }
        : n
  }
  set({ notes })
}

export async function loadScripts(): Promise<void> {
  if (!api || state.scriptsStatus === 'loading') return
  set({ scriptsStatus: 'loading', scriptsError: null })
  try {
    const list = await requireApi().listByPrefix(SCRIPTS_DB.pathPrefix)
    mergeNotes(list)
    set({
      scripts: list.map((n) => n.path),
      scriptsStatus: 'ready',
    })
  } catch (e) {
    handleAuthFailure(e)
    set({
      scriptsStatus: 'error',
      scriptsError: e instanceof Error ? e.message : String(e),
    })
  }
}

export async function loadTags(): Promise<void> {
  if (!api) return
  try {
    set({ tags: await requireApi().listTags() })
  } catch (e) {
    handleAuthFailure(e)
  }
}

export async function searchVault(query: string): Promise<Note[]> {
  try {
    const results = await requireApi().search(query)
    mergeNotes(results)
    return results
  } catch (e) {
    handleAuthFailure(e)
    throw e
  }
}

export async function recentNotes(): Promise<Note[]> {
  try {
    const results = await requireApi().listRecent()
    mergeNotes(results)
    return results
  } catch (e) {
    handleAuthFailure(e)
    throw e
  }
}

export async function fetchNote(
  path: string,
  opts: { refresh?: boolean } = {},
): Promise<Note | null> {
  const cached = state.notes[path]
  if (!opts.refresh && cached?.content !== undefined) return cached
  try {
    const note = await requireApi().getNote(path)
    if (!note) return null
    return mergeNote(note)
  } catch (e) {
    handleAuthFailure(e)
    throw e
  }
}

// ---------------------------------------------------------------------------
// Writes — serialized per note, conflict-reconciled
// ---------------------------------------------------------------------------

const writeQueue = new Map<string, Promise<unknown>>()

function markSaving(path: string, delta: number): void {
  const count = (state.saving[path] ?? 0) + delta
  const saving = { ...state.saving }
  if (count <= 0) delete saving[path]
  else saving[path] = count
  set({ saving })
}

/** Serialize writes per path so OC preconditions never race each other. */
function enqueue<T>(path: string, job: () => Promise<T>): Promise<T> {
  const prev = writeQueue.get(path) ?? Promise.resolve()
  const next = prev.then(job, job)
  writeQueue.set(
    path,
    next.catch(() => {}),
  )
  return next
}

type PatchOf = Pick<
  Parameters<VaultApi['updateNote']>[1],
  'content' | 'metadata' | 'tags'
>

/**
 * Core conflict-reconciling write. `makePatch` derives the patch from the
 * freshest known note, so on a 409 the intent is re-applied to the live
 * note rather than blindly retried. A second consecutive conflict bubbles.
 * `baseOverride` lets callers pin the pre-optimistic note as the first
 * attempt's base (diffs must never be computed against their own optimism).
 */
async function mutateNote(
  path: string,
  makePatch: (base: Note) => PatchOf | null,
  baseOverride?: Note,
): Promise<Note> {
  return enqueue(path, async () => {
    markSaving(path, 1)
    try {
      const base = baseOverride ?? state.notes[path] ?? (await fetchNote(path))
      if (!base) throw new Error(`Note not found: ${path}`)
      let patch = makePatch(base)
      if (!patch) return base
      try {
        const updated = await requireApi().updateNote(path, {
          ...patch,
          ifUpdatedAt: base.updatedAt,
        })
        return mergeNote(updated)
      } catch (e) {
        if (!(e instanceof VaultConflictError)) throw e
        // Reload → reconcile → retry once.
        const fresh = await requireApi().getNote(path)
        if (!fresh) throw new Error(`Note disappeared: ${path}`)
        mergeNote(fresh)
        patch = makePatch(fresh)
        if (!patch) return fresh
        const updated = await requireApi().updateNote(path, {
          ...patch,
          ifUpdatedAt: fresh.updatedAt,
        })
        return mergeNote(updated)
      }
    } catch (e) {
      handleAuthFailure(e)
      throw e
    } finally {
      markSaving(path, -1)
    }
  })
}

/**
 * Metadata-only write (table cells, board moves, property chips). Only the
 * changed keys are sent; the vault merges them server-side. Optimistic UI
 * with revert + toast on failure.
 */
export async function setMetadata(
  path: string,
  patch: NoteMetadata,
  opts: { undo?: NoteMetadata; silent?: boolean } = {},
): Promise<boolean> {
  const before = state.notes[path]
  if (before) {
    mergeNote({ ...before, metadata: { ...before.metadata, ...patch } })
  }
  try {
    await mutateNote(path, () => ({ metadata: patch }))
    if (!opts.silent && opts.undo) {
      const undoPatch = opts.undo
      toast('success', describeMetadataPatch(patch), {
        label: 'Undo',
        run: () => void setMetadata(path, undoPatch, { silent: true }),
      })
    }
    return true
  } catch (e) {
    if (before) mergeNote(before)
    toast('error', `Couldn’t save — ${e instanceof Error ? e.message : e}`)
    return false
  }
}

function describeMetadataPatch(patch: NoteMetadata): string {
  const entries = Object.entries(patch)
  if (entries.length === 1) {
    const [k, v] = entries[0]!
    return `${k} → ${String(v)}`
  }
  return 'Saved to vault'
}

/** Full-replace tag edit, expressed to the vault as an add/remove diff. */
export async function replaceTags(
  path: string,
  nextTags: string[],
): Promise<boolean> {
  const target = [...new Set(nextTags)]
  const before = state.notes[path]
  if (before) mergeNote({ ...before, tags: target })
  try {
    await mutateNote(
      path,
      (base) => {
        const current = new Set(base.tags)
        const wanted = new Set(target)
        const add = target.filter((t) => !current.has(t))
        const remove = base.tags.filter((t) => !wanted.has(t))
        if (add.length === 0 && remove.length === 0) return null
        return { tags: { add, remove } }
      },
      // Diff against the pre-optimistic note, never our own optimism.
      before,
    )
    return true
  } catch (e) {
    if (before) mergeNote(before)
    toast('error', `Couldn’t save tags — ${e instanceof Error ? e.message : e}`)
    return false
  }
}

/**
 * Body save. On conflict: if only metadata/tags moved (content identical to
 * our editing base) the save is replayed onto the live note; if the content
 * itself diverged, surface a ContentDivergedError for a human decision.
 */
export async function saveContent(
  path: string,
  content: string,
  base: { updatedAt: string; content: string },
): Promise<Note> {
  return enqueue(path, async () => {
    markSaving(path, 1)
    try {
      try {
        const updated = await requireApi().updateNote(path, {
          content,
          ifUpdatedAt: base.updatedAt,
        })
        return mergeNote(updated)
      } catch (e) {
        if (!(e instanceof VaultConflictError)) throw e
        const fresh = await requireApi().getNote(path)
        if (!fresh) throw new Error(`Note disappeared: ${path}`)
        mergeNote(fresh)
        if ((fresh.content ?? '') !== base.content) {
          throw new ContentDivergedError(fresh)
        }
        const updated = await requireApi().updateNote(path, {
          content,
          ifUpdatedAt: fresh.updatedAt,
        })
        return mergeNote(updated)
      }
    } catch (e) {
      handleAuthFailure(e)
      throw e
    } finally {
      markSaving(path, -1)
    }
  })
}

/** Explicit human overwrite after reviewing a content conflict. */
export async function forceContent(
  path: string,
  content: string,
  liveUpdatedAt: string,
): Promise<Note> {
  return enqueue(path, async () => {
    markSaving(path, 1)
    try {
      const updated = await requireApi().updateNote(path, {
        content,
        ifUpdatedAt: liveUpdatedAt,
      })
      return mergeNote(updated)
    } catch (e) {
      handleAuthFailure(e)
      throw e
    } finally {
      markSaving(path, -1)
    }
  })
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createScript(input: {
  title: string
  body: string
  metadata: NoteMetadata
}): Promise<Note> {
  const a = requireApi()
  const slug = slugify(input.title) || 'untitled'
  const prefix = SCRIPTS_DB.newNote.pathPrefix
  let path = `${prefix}${slug}`
  for (let n = 2; (await a.getNote(path)) !== null; n++) {
    path = `${prefix}${slug}-${n}`
    if (n > 30) throw new Error('Could not find a free path for this title')
  }
  const heading = input.title.trim()
  const body = input.body.trim()
  const content = body ? `# ${heading}\n\n${body}\n` : `# ${heading}\n`
  try {
    const note = await a.createNote({
      path,
      content,
      tags: SCRIPTS_DB.newNote.tags,
      metadata: { ...SCRIPTS_DB.newNote.metadata, ...input.metadata },
    })
    mergeNote(note)
    if (state.scripts && !state.scripts.includes(note.path)) {
      set({ scripts: [...state.scripts, note.path] })
    }
    return note
  } catch (e) {
    handleAuthFailure(e)
    throw e
  }
}
