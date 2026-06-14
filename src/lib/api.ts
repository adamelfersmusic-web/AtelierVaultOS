// Thin client over the Parachute Vault REST API.
// Base = <vault url>/api ; the AuthManager supplies a live access token for
// every request (proactive refresh near expiry, reactive refresh + single
// replay on a 401).

import type { AuthManager } from './auth'
import {
  VaultAuthError,
  VaultConflictError,
  VaultError,
  type Note,
  type NoteMetadata,
  type TagInfo,
} from './types'

/**
 * Note ids/paths contain slashes (content/scripts/the-fake-map). For
 * path-addressed routes (PATCH) the segments are percent-encoded and the
 * slashes kept. Some deployments instead route the whole id as one
 * %2F-encoded segment, so on a 404 for a slashed id we retry once with the
 * alternate form and remember which one the server accepted.
 */
type PathStyle = 'segments' | 'whole'
const PATH_STYLE_KEY = 'atelier.pathStyle'

function encodeNoteId(id: string, style: PathStyle): string {
  return style === 'whole'
    ? encodeURIComponent(id)
    : id.split('/').map(encodeURIComponent).join('/')
}

export class VaultApi {
  private auth: AuthManager
  private pathStyle: PathStyle

  constructor(auth: AuthManager) {
    this.auth = auth
    this.pathStyle =
      (localStorage.getItem(PATH_STYLE_KEY) as PathStyle | null) ?? 'segments'
  }

  private get baseUrl(): string {
    return this.auth.vaultBase.replace(/\/+$/, '')
  }

  private async send(
    method: string,
    path: string,
    token: string,
    body?: unknown,
  ): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/api${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
    } catch (e) {
      throw new VaultError(
        0,
        `Could not reach the vault at ${this.baseUrl} — ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    let token = await this.auth.getAccessToken()
    let res = await this.send(method, path, token, body)

    // Access token rejected — try one silent refresh, then replay.
    if (res.status === 401 && (await this.auth.tryRefresh())) {
      token = await this.auth.getAccessToken()
      res = await this.send(method, path, token, body)
    }

    if (res.status === 204) return undefined as T
    let data: any = null
    try {
      data = await res.json()
    } catch {
      /* non-JSON body */
    }
    if (!res.ok) {
      const message: string =
        data?.message || data?.error || `${res.status} ${res.statusText}`
      if (res.status === 401 || res.status === 403) {
        throw new VaultAuthError(res.status, message)
      }
      if (res.status === 409 && data?.error_type === 'conflict') {
        throw new VaultConflictError(message, data?.current_updated_at ?? null)
      }
      throw new VaultError(res.status, message, data?.error_type ?? data?.code)
    }
    return data as T
  }

  /** Run a note-path-addressed request, falling back across encoding styles. */
  private async withNoteRoute<T>(
    id: string,
    run: (encodedId: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await run(encodeNoteId(id, this.pathStyle))
    } catch (e) {
      const flippable =
        e instanceof VaultError && e.status === 404 && id.includes('/')
      if (!flippable) throw e
      const alt: PathStyle = this.pathStyle === 'segments' ? 'whole' : 'segments'
      const result = await run(encodeNoteId(id, alt))
      this.pathStyle = alt
      localStorage.setItem(PATH_STYLE_KEY, alt)
      return result
    }
  }

  /**
   * Guarantee the shape the rest of the app relies on. The lean Note type
   * says `tags`/`metadata` are always present, but real vault responses can
   * omit them on a note with no tags or no metadata — and an unguarded
   * `note.tags.slice()` / `note.metadata[k]` then throws deep in a view.
   * Normalizing once at the boundary makes the type honest everywhere.
   */
  private static normalize(n: Note): Note {
    if (n.tags && n.metadata) return n
    return { ...n, tags: n.tags ?? [], metadata: n.metadata ?? {} }
  }

  /** Cheap connectivity + auth probe. */
  async ping(): Promise<void> {
    await this.request<Note[]>('GET', '/notes?limit=1')
  }

  /** Single note by id or path, with content. Returns null when missing. */
  async getNote(idOrPath: string): Promise<Note | null> {
    try {
      // The collection route's ?id= form accepts raw slashes in the query
      // string, so it is the safest single-note read across deployments.
      return VaultApi.normalize(
        await this.request<Note>(
          'GET',
          `/notes?id=${encodeURIComponent(idOrPath)}&include_content=true`,
        ),
      )
    } catch (e) {
      if (e instanceof VaultError && e.status === 404) return null
      throw e
    }
  }

  /** Lean list (no content) of every note under a path prefix. */
  async listByPrefix(prefix: string, limit = 500): Promise<Note[]> {
    const p = new URLSearchParams({
      path_prefix: prefix,
      limit: String(limit),
      include_content: 'false',
    })
    return (await this.request<Note[]>('GET', `/notes?${p.toString()}`)).map(
      VaultApi.normalize,
    )
  }

  /** Full-text search across the vault (lean shape). */
  async search(query: string, limit = 80): Promise<Note[]> {
    const p = new URLSearchParams({
      search: query,
      limit: String(limit),
      include_content: 'false',
    })
    return (await this.request<Note[]>('GET', `/notes?${p.toString()}`)).map(
      VaultApi.normalize,
    )
  }

  /** Full-text search WITH note bodies — the retrieval step for /ai RAG. */
  async searchWithContent(query: string, limit = 50): Promise<Note[]> {
    const p = new URLSearchParams({
      search: query,
      limit: String(limit),
      include_content: 'true',
    })
    return (await this.request<Note[]>('GET', `/notes?${p.toString()}`)).map(
      VaultApi.normalize,
    )
  }

  /** Most recently created notes, vault-wide (lean shape). */
  async listRecent(limit = 60): Promise<Note[]> {
    const p = new URLSearchParams({
      limit: String(limit),
      sort: 'desc',
      include_content: 'false',
    })
    return (await this.request<Note[]>('GET', `/notes?${p.toString()}`)).map(
      VaultApi.normalize,
    )
  }

  async listTags(): Promise<TagInfo[]> {
    return this.request<TagInfo[]>('GET', '/tags')
  }

  /**
   * The whole vault as a graph: every note (lean) with its hydrated links
   * and link degree. One call — the graph view's only data dependency.
   */
  async graphNotes(limit = 300): Promise<Note[]> {
    const p = new URLSearchParams({
      include_links: 'true',
      include_link_count: 'true',
      include_content: 'false',
      limit: String(limit),
    })
    return (await this.request<Note[]>('GET', `/notes?${p.toString()}`)).map(
      VaultApi.normalize,
    )
  }

  async createNote(input: {
    path: string
    content: string
    tags: string[]
    metadata: NoteMetadata
  }): Promise<Note> {
    return VaultApi.normalize(await this.request<Note>('POST', '/notes', input))
  }

  /**
   * PATCH a note with optimistic concurrency. `metadata` keys are merged
   * server-side; tag changes are expressed as add/remove sets; content is a
   * full replace. Throws VaultConflictError on a stale `if_updated_at`.
   */
  async updateNote(
    idOrPath: string,
    patch: {
      content?: string
      metadata?: NoteMetadata
      tags?: { add?: string[]; remove?: string[] }
      ifUpdatedAt: string
    },
  ): Promise<Note> {
    const body: Record<string, unknown> = { if_updated_at: patch.ifUpdatedAt }
    if (patch.content !== undefined) body.content = patch.content
    if (patch.metadata !== undefined) body.metadata = patch.metadata
    if (patch.tags !== undefined) body.tags = patch.tags
    const updated = await this.withNoteRoute(idOrPath, (enc) =>
      this.request<Note>('PATCH', `/notes/${enc}`, body),
    )
    return VaultApi.normalize(updated)
  }

  /**
   * Delete a note by id or path. Uses the same path-addressed route + encoding
   * fallback as PATCH. The Parachute REST API answers 200 (with a
   * `{ deleted, id }` body) or 204 — either is treated as success. A 404/405
   * propagates as a VaultError so a missing route surfaces loudly to the caller
   * instead of failing silently.
   */
  async deleteNote(idOrPath: string): Promise<void> {
    await this.withNoteRoute(idOrPath, (enc) =>
      this.request<unknown>('DELETE', `/notes/${enc}`),
    )
  }
}
