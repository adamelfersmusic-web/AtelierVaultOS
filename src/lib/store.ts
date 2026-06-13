// Global session store: vault connection (OAuth or pasted token), note cache,
// write pipeline.
//
// Every write is human-initiated and goes through optimistic concurrency:
// the note's last-known updatedAt rides along as if_updated_at, and a 409
// triggers reload → reconcile → retry instead of clobbering. Writes to the
// same note are serialized so rapid edits can't race each other's
// preconditions.

import { useSyncExternalStore } from 'react'
import { VaultApi } from './api'
import { AuthManager, type AuthSession } from './auth'
import {
  beginOAuth,
  clearCachedClients,
  clearPending,
  completeOAuth,
  loadPending,
  normalizeVaultUrl,
  PendingApprovalError,
  resolveVaultUrl,
  storedFromTokenResponse,
} from './oauth'
import { slugify } from './format'
import {
  VaultAuthError,
  VaultConflictError,
  type Note,
  type NoteMetadata,
  type TagInfo,
} from './types'
import { SCRIPTS_DB } from '../domain/scripts'

const SESSION_KEY = 'atelier.session.v1'
const LEGACY_CONFIG_KEY = 'atelier.vault' // v1 token-paste config, migrated on load
const LAST_URL_KEY = 'atelier.lastVaultUrl'

export type ConnectionState = 'idle' | 'ok' | 'auth-error'

export interface ToastItem {
  id: number
  kind: 'success' | 'error' | 'info'
  text: string
  action?: { label: string; run: () => void }
}

export interface StoreState {
  session: AuthSession | null
  connection: ConnectionState
  /** OAuth return in progress (exchanging the code). */
  oauthStatus: 'idle' | 'completing'
  oauthError: string | null
  /** Hub requires approval of this client — link the human must visit. */
  approveUrl: string | null
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

// ---------------------------------------------------------------------------
// Session persistence (+ migration from the v1 token-paste config)
// ---------------------------------------------------------------------------

function loadSavedSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AuthSession>
      if (parsed.vaultUrl && parsed.token?.accessToken) return parsed as AuthSession
    }
  } catch {
    /* fall through to legacy */
  }
  try {
    const legacy = localStorage.getItem(LEGACY_CONFIG_KEY)
    if (legacy) {
      const parsed = JSON.parse(legacy)
      if (typeof parsed?.url === 'string' && typeof parsed?.token === 'string') {
        const session: AuthSession = {
          vaultUrl: parsed.url,
          mode: 'token',
          token: { accessToken: parsed.token },
        }
        localStorage.setItem(SESSION_KEY, JSON.stringify(session))
        localStorage.removeItem(LEGACY_CONFIG_KEY)
        return session
      }
    }
  } catch {
    /* corrupted config — treat as signed out */
  }
  return null
}

function saveSession(session: AuthSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function lastVaultUrl(): string | null {
  return localStorage.getItem(LAST_URL_KEY)
}

let api: VaultApi | null = null
let manager: AuthManager | null = null

let state: StoreState = {
  session: null,
  connection: 'idle',
  oauthStatus: 'idle',
  oauthError: null,
  approveUrl: null,
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
// Connection lifecycle
// ---------------------------------------------------------------------------

function adoptSession(session: AuthSession): void {
  saveSession(session)
  manager = new AuthManager(session, (rotated) => {
    // Persist every refresh-token rotation the moment it happens.
    saveSession(rotated)
    set({ session: rotated })
  })
  api = new VaultApi(manager)
  set({
    session,
    connection: 'ok',
    oauthError: null,
    approveUrl: null,
    scriptsStatus: 'idle',
    notes: {},
  })
  void loadScripts()
  void loadTags()
}

/** Synchronous boot: restore a saved session (called before first render). */
export function init(): void {
  const session = loadSavedSession()
  if (session) adoptSession(session)
}

/**
 * Handle an OAuth return (?code&state or ?error) if one is present in the
 * URL. Mirrors the proven reference wiring: strip the params immediately so a
 * refresh doesn't re-run the exchange, then complete the code → token swap.
 */
export async function processOAuthReturn(): Promise<void> {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  const oauthState = params.get('state')
  const hubError = params.get('error')
  if (!((code && oauthState) || hubError)) return

  const cleanUrl = window.location.origin + window.location.pathname
  window.history.replaceState(null, '', cleanUrl)

  if (hubError) {
    const description = params.get('error_description')
    set({ oauthError: `The hub returned: ${description || hubError}` })
    return
  }
  if (!loadPending()) {
    // Stale or bookmarked callback — init() already restored any saved session.
    return
  }

  set({ oauthStatus: 'completing', oauthError: null, approveUrl: null })
  try {
    const { pending, token } = await completeOAuth(code!, oauthState!)
    const vaultUrl = resolveVaultUrl(token, pending.issuerUrl)
    adoptSession({
      vaultUrl,
      mode: 'oauth',
      issuer: pending.issuer,
      tokenEndpoint: pending.tokenEndpoint,
      clientId: pending.clientId,
      token: storedFromTokenResponse(token),
    })
    set({ oauthStatus: 'idle' })
  } catch (e) {
    if (e instanceof PendingApprovalError) {
      set({ oauthStatus: 'idle', approveUrl: e.approveUrl })
    } else {
      set({
        oauthStatus: 'idle',
        oauthError: e instanceof Error ? e.message : String(e),
      })
    }
  }
}

/** Primary path: kick off the OAuth redirect dance. */
export async function startOAuth(vaultInput: string): Promise<void> {
  set({ oauthError: null, approveUrl: null })
  const url = normalizeVaultUrl(vaultInput)
  localStorage.setItem(LAST_URL_KEY, url)
  const authorizeUrl = await beginOAuth(url) // throws with a precise message
  window.location.assign(authorizeUrl)
}

/** Advanced path: paste a bearer token (kept from v1). */
export async function connectWithToken(url: string, token: string): Promise<void> {
  const vaultUrl = normalizeVaultUrl(url)
  const session: AuthSession = {
    vaultUrl,
    mode: 'token',
    token: { accessToken: token.trim() },
  }
  const probeManager = new AuthManager(session, () => {})
  await new VaultApi(probeManager).ping() // throws with a precise message
  localStorage.setItem(LAST_URL_KEY, vaultUrl)
  adoptSession(session)
}

/** Clears ALL stored auth: session, refresh material, pending flow, client ids. */
export function disconnect(): void {
  localStorage.removeItem(SESSION_KEY)
  localStorage.removeItem(LEGACY_CONFIG_KEY)
  clearPending()
  clearCachedClients()
  api = null
  manager = null
  set({
    session: null,
    connection: 'idle',
    oauthStatus: 'idle',
    oauthError: null,
    approveUrl: null,
    notes: {},
    scripts: null,
    scriptsStatus: 'idle',
    scriptsError: null,
    tags: [],
  })
}

export function dismissOAuthNotices(): void {
  set({ oauthError: null, approveUrl: null })
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

export async function fetchGraphNotes(): Promise<Note[]> {
  try {
    const results = await requireApi().graphNotes()
    // Warm the note cache (lean shapes) so clicking a node opens fast.
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
