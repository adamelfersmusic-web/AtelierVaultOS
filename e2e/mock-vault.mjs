// Mock Parachute vault — a faithful local stand-in for the REST API surface
// this app uses, replicating the real server's behavior (verified against
// parachute-vault src/routes.ts):
//   · Bearer auth on every route (vault:read for GET, vault:write otherwise)
//   · GET  /api/notes            list w/ path_prefix, search, limit, ?id=
//   · GET  /api/notes/:id        single, one URL segment (encoded slashes)
//   · POST /api/notes            create → 201, path_conflict → 409
//   · PATCH /api/notes/:id       if_updated_at required (else 428),
//                                conflict → 409 {error_type:"conflict",...},
//                                metadata merged, tags {add,remove}
//   · GET  /api/tags
//   · CORS: ACAO * + PATCH + Authorization, OPTIONS → 204
// Plus /__test/* control endpoints for the e2e drive.
//
// Run: npm run mock   (listens on http://127.0.0.1:8787)

import http from 'node:http'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { makeSeed, LINK_DEFS, TAGS } from './seed.mjs'

const PORT = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 8787
const TOKEN = 'atelier-test-token'
const ISSUER = `http://127.0.0.1:${PORT}`

// MOCK_REAL_GRAPH=1 serves a local mirror of the REAL vault's structure
// (e2e/real-graph/{nodes,edges}.json — gitignored, never committed) so the
// graph can be visually verified against the genuine 285-note constellation.
const REAL_GRAPH =
  process.env.MOCK_REAL_GRAPH === '1' &&
  existsSync(new URL('./real-graph/nodes.json', import.meta.url)) &&
  existsSync(new URL('./real-graph/edges.json', import.meta.url))

function makeDataset() {
  if (!REAL_GRAPH) {
    return { notes: makeSeed(), linkDefs: LINK_DEFS, byPath: true }
  }
  const rg = (f) => JSON.parse(readFileSync(new URL(`./real-graph/${f}`, import.meta.url), 'utf8'))
  const now = new Date().toISOString()
  const notes = rg('nodes.json').map((n) => ({
    id: n.id,
    path: n.path,
    extension: 'md',
    content: `# ${n.path.split('/').pop()}\n\n_Local mirror — body not synced._\n`,
    tags: n.tags,
    metadata: n.verification ? { verification: n.verification } : {},
    createdAt: now,
    updatedAt: now,
  }))
  const linkDefs = rg('edges.json').map((e) => ({ s: e.s, t: e.t, rel: e.rel }))
  return { notes, linkDefs, byPath: false }
}

const dataset = makeDataset()
let notes = dataset.notes
let lastTs = Date.now()
let idSeq = 900000

/** Resolve link defs (by path for the seed, by id for the real mirror)
 * against the live notes array → [{sourceId, targetId, relationship}]. */
function resolvedLinks() {
  const key = (n) => (dataset.byPath ? n.path : n.id)
  const idByKey = new Map(notes.map((n) => [key(n), n.id]))
  const out = []
  for (const d of dataset.linkDefs) {
    const s = idByKey.get(d.s)
    const t = idByKey.get(d.t)
    if (s && t) out.push({ sourceId: s, targetId: t, relationship: d.rel })
  }
  return out
}

// ——— OAuth issuer state (mirrors the Parachute hub's protocol surface) ———
const freshOAuth = () => ({
  clients: new Map(), // client_id → { redirect_uris, registration }
  codes: new Map(), // code → { clientId, redirectUri, challenge, scope, used }
  validAccessTokens: new Set(),
  currentRefreshToken: null,
  tokenSeq: 1,
  rotationCount: 0,
  approvalMode: false, // when true, token exchange returns invalid_client + approve_url
  expiresIn: 3600,
  lastRegistration: null,
})
let oauth = freshOAuth()

function issueTokens() {
  const n = oauth.tokenSeq++
  const access = `mock-at-${n}`
  const refresh = `mock-rt-${n}`
  oauth.validAccessTokens.add(access)
  oauth.currentRefreshToken = refresh
  return {
    access_token: access,
    token_type: 'bearer',
    scope: 'vault:read vault:write',
    vault: 'mockvault',
    refresh_token: refresh,
    expires_in: oauth.expiresIn,
    services: { vault: { url: ISSUER }, 'vault:mockvault': { url: ISSUER } },
  }
}

const nextStamp = () => {
  lastTs = Math.max(Date.now(), lastTs + 1)
  return new Date(lastTs).toISOString()
}

const BASE_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
}

// Credentialed requests (the DCR POST sends `credentials: 'include'`, like
// the hub expects) forbid ACAO `*` — echo the caller's origin instead, the
// way the real hub does.
function corsFor(req) {
  const origin = req.headers.origin
  return origin
    ? {
        ...BASE_CORS,
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Credentials': 'true',
      }
    : BASE_CORS
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...(res.corsHeaders ?? BASE_CORS) })
  res.end(JSON.stringify(body))
}

function lean(n) {
  const { content, ...rest } = n
  return {
    ...rest,
    byteSize: Buffer.byteLength(content ?? ''),
    preview: (content ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
  }
}

function findNote(idOrPath) {
  return (
    notes.find((n) => n.id === idOrPath) ??
    notes.find((n) => n.path.toLowerCase() === idOrPath.toLowerCase())
  )
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = url.pathname
  res.corsHeaders = corsFor(req)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, res.corsHeaders)
    return res.end()
  }

  // ——— test control plane (no auth) ———
  if (path === '/__test/reset' && req.method === 'POST') {
    notes = REAL_GRAPH ? makeDataset().notes : makeSeed()
    oauth = freshOAuth()
    return json(res, 200, { ok: true })
  }
  if (path === '/__test/oauth' && req.method === 'POST') {
    const body = await readBody(req)
    if (typeof body.approvalMode === 'boolean') oauth.approvalMode = body.approvalMode
    if (typeof body.expiresIn === 'number') oauth.expiresIn = body.expiresIn
    if (body.revokeAccess === true) oauth.validAccessTokens.clear()
    return json(res, 200, { ok: true })
  }
  if (path === '/__test/oauth-state' && req.method === 'GET') {
    return json(res, 200, {
      rotationCount: oauth.rotationCount,
      approvalMode: oauth.approvalMode,
      clientCount: oauth.clients.size,
      currentRefreshToken: oauth.currentRefreshToken,
      validAccessTokens: [...oauth.validAccessTokens],
      lastRegistration: oauth.lastRegistration,
    })
  }

  // ——— OAuth issuer (RFC 8414 discovery + RFC 7591 DCR + PKCE code flow) ———
  if (path === '/.well-known/oauth-authorization-server' && req.method === 'GET') {
    return json(res, 200, {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/oauth/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      registration_endpoint: `${ISSUER}/oauth/register`,
      code_challenge_methods_supported: ['S256'],
    })
  }

  if (path === '/oauth/register' && req.method === 'POST') {
    const body = await readBody(req)
    if (
      !Array.isArray(body.redirect_uris) ||
      body.redirect_uris.length === 0 ||
      body.token_endpoint_auth_method !== 'none'
    ) {
      return json(res, 400, { error: 'invalid_client_metadata' })
    }
    const clientId = `mock-client-${randomBytes(6).toString('hex')}`
    oauth.clients.set(clientId, { redirect_uris: body.redirect_uris })
    oauth.lastRegistration = body
    return json(res, 201, { client_id: clientId })
  }

  if (path === '/oauth/authorize' && req.method === 'GET') {
    const q = url.searchParams
    const clientId = q.get('client_id') ?? ''
    const redirectUri = q.get('redirect_uri') ?? ''
    const challenge = q.get('code_challenge') ?? ''
    const state = q.get('state') ?? ''
    const client = oauth.clients.get(clientId)
    const bad = (msg) => {
      res.writeHead(400, { 'Content-Type': 'text/plain', ...res.corsHeaders })
      res.end(`authorize error: ${msg}`)
    }
    if (!client) return bad('unknown client_id')
    if (!client.redirect_uris.includes(redirectUri)) return bad('redirect_uri mismatch')
    if (q.get('response_type') !== 'code') return bad('response_type must be code')
    if (!challenge || q.get('code_challenge_method') !== 'S256') return bad('S256 PKCE required')
    const code = `mock-code-${randomBytes(8).toString('hex')}`
    oauth.codes.set(code, {
      clientId,
      redirectUri,
      challenge,
      scope: q.get('scope') ?? '',
      used: false,
    })
    const back = new URL(redirectUri)
    back.searchParams.set('code', code)
    back.searchParams.set('state', state)
    res.writeHead(200, { 'Content-Type': 'text/html', ...res.corsHeaders })
    return res.end(`<!doctype html><html><head><title>Mock Hub — Sign in</title></head>
<body style="font-family:sans-serif;background:#111;color:#eee;display:grid;place-items:center;height:100vh">
<main style="text-align:center">
<h1>Mock Parachute Hub</h1>
<p>Atelier Vault OS wants access to <b>mockvault</b>.</p>
<a id="approve" href="${back.toString()}" style="display:inline-block;padding:10px 22px;background:#C4923A;color:#111;border-radius:8px;text-decoration:none;font-weight:600">Approve sign-in</a>
</main></body></html>`)
  }

  if (path === '/oauth/token' && req.method === 'POST') {
    const chunks = []
    for await (const c of req) chunks.push(c)
    const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
    const grant = form.get('grant_type')

    if (grant === 'authorization_code') {
      if (oauth.approvalMode) {
        return json(res, 400, {
          error: 'invalid_client',
          approve_url: `${ISSUER}/oauth/approve?client_id=${form.get('client_id')}`,
        })
      }
      const entry = oauth.codes.get(form.get('code') ?? '')
      if (!entry || entry.used) return json(res, 400, { error: 'invalid_grant' })
      if (entry.clientId !== form.get('client_id')) return json(res, 400, { error: 'invalid_client' })
      if (entry.redirectUri !== form.get('redirect_uri')) return json(res, 400, { error: 'invalid_grant' })
      const verifier = form.get('code_verifier') ?? ''
      const derived = createHash('sha256').update(verifier).digest('base64url')
      if (derived !== entry.challenge) return json(res, 400, { error: 'invalid_grant', detail: 'PKCE mismatch' })
      entry.used = true // single-use codes, per OAuth 2.1
      return json(res, 200, issueTokens())
    }

    if (grant === 'refresh_token') {
      // Strict rotation: only the CURRENT refresh token is accepted.
      if (form.get('refresh_token') !== oauth.currentRefreshToken) {
        return json(res, 400, { error: 'invalid_grant' })
      }
      // Old access tokens die with the rotation.
      oauth.validAccessTokens.clear()
      oauth.rotationCount++
      return json(res, 200, issueTokens())
    }

    return json(res, 400, { error: 'unsupported_grant_type' })
  }

  if (path === '/oauth/approve' && req.method === 'GET') {
    // Visiting the approval page approves the client (simulates the hub admin).
    oauth.approvalMode = false
    res.writeHead(200, { 'Content-Type': 'text/html', ...res.corsHeaders })
    return res.end('<!doctype html><body style="font-family:sans-serif"><h1>Approved</h1><p>Return to the app and sign in again.</p></body>')
  }
  if (path === '/__test/note' && req.method === 'GET') {
    const n = findNote(url.searchParams.get('path') ?? '')
    return n ? json(res, 200, n) : json(res, 404, { error: 'missing' })
  }
  if (path === '/__test/bump' && req.method === 'POST') {
    // Simulate an out-of-band writer (another agent) touching a note.
    const body = await readBody(req)
    const n = findNote(body.path)
    if (!n) return json(res, 404, { error: 'missing' })
    if (body.content !== undefined) n.content = body.content
    if (body.metadata) n.metadata = { ...n.metadata, ...body.metadata }
    n.updatedAt = nextStamp()
    return json(res, 200, n)
  }

  if (path === '/api/health') {
    return json(res, 200, { status: 'ok', vault: 'mock' })
  }

  // ——— auth: the static operator token, or any live OAuth access token ———
  const auth = req.headers.authorization ?? ''
  const bearer = auth.replace(/^Bearer /, '')
  if (auth !== `Bearer ${TOKEN}` && !oauth.validAccessTokens.has(bearer)) {
    const verb = req.method === 'GET' ? 'vault:read' : 'vault:write'
    return json(res, 401, {
      error: 'Unauthorized',
      message: `This endpoint requires the '${verb}' scope.`,
    })
  }

  // ——— /api/tags ———
  if (path === '/api/tags' && req.method === 'GET') {
    return json(res, 200, TAGS)
  }

  // ——— /api/notes collection ———
  if (path === '/api/notes') {
    if (req.method === 'GET') {
      const id = url.searchParams.get('id')
      if (id) {
        const n = findNote(id)
        if (!n) return json(res, 404, { error: 'Note not found', id })
        const includeContent = url.searchParams.get('include_content') !== 'false'
        return json(res, 200, includeContent ? n : lean(n))
      }
      let out = [...notes]
      const prefix = url.searchParams.get('path_prefix')
      if (prefix) {
        out = out.filter((n) =>
          n.path.toLowerCase().startsWith(prefix.toLowerCase()),
        )
      }
      const search = url.searchParams.get('search')
      if (search) {
        const q = search.toLowerCase()
        out = out.filter(
          (n) =>
            (n.content ?? '').toLowerCase().includes(q) ||
            n.path.toLowerCase().includes(q),
        )
      }
      if (url.searchParams.get('sort') === 'desc') {
        out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      }
      const limit = Number(url.searchParams.get('limit') ?? 50)
      out = out.slice(0, limit)
      const includeContent = url.searchParams.get('include_content') === 'true'
      let shaped = includeContent ? out : out.map(lean)
      // Graph enrichments — same field names as the real server.
      const wantLinks = url.searchParams.get('include_links') === 'true'
      const wantCount = url.searchParams.get('include_link_count') === 'true'
      if (wantLinks || wantCount) {
        const links = resolvedLinks()
        shaped = shaped.map((n) => {
          const touching = links.filter(
            (l) => l.sourceId === n.id || l.targetId === n.id,
          )
          return {
            ...n,
            ...(wantLinks ? { links: touching } : {}),
            ...(wantCount ? { linkCount: touching.length } : {}),
          }
        })
      }
      return json(res, 200, shaped)
    }

    if (req.method === 'POST') {
      const body = await readBody(req)
      const p = body.path
      if (!p) return json(res, 400, { error: 'path required' })
      if (findNote(p)) {
        return json(res, 409, {
          error_type: 'path_conflict',
          error: 'path_conflict',
          path: p,
          message: `A note already exists at path "${p}"`,
        })
      }
      const now = nextStamp()
      const note = {
        id: `2026-06-12-00-00-00-${idSeq++}`,
        path: p,
        extension: 'md',
        content: body.content ?? '',
        tags: body.tags ?? [],
        metadata: body.metadata ?? {},
        createdAt: now,
        updatedAt: now,
      }
      notes.push(note)
      return json(res, 201, note)
    }

    return json(res, 405, { error: 'Method not allowed' })
  }

  // ——— /api/notes/:idOrPath — single URL segment, like the real server ———
  if (path.startsWith('/api/notes/')) {
    const subpath = path.slice('/api/notes'.length)
    const m = subpath.match(/^\/([^/]+)(\/.*)?$/)
    if (!m || (m[2] ?? '') !== '') return json(res, 404, { error: 'Not found' })
    const idOrPath = decodeURIComponent(m[1])
    const note = findNote(idOrPath)

    if (req.method === 'GET') {
      if (!note) return json(res, 404, { error: 'Not found' })
      const includeContent = url.searchParams.get('include_content') !== 'false'
      return json(res, 200, includeContent ? note : lean(note))
    }

    if (req.method === 'PATCH') {
      const body = await readBody(req)
      if (!note) return json(res, 404, { error: `Note not found: "${idOrPath}"` })
      if (body.if_updated_at === undefined && body.force !== true) {
        return json(res, 428, {
          error_type: 'precondition_required',
          error: 'precondition_required',
          message:
            'update requires `if_updated_at` (the note’s last-seen updated_at) or `force: true`.',
          note_id: note.id,
          path: note.path,
        })
      }
      if (
        body.if_updated_at !== undefined &&
        body.if_updated_at !== note.updatedAt
      ) {
        return json(res, 409, {
          error_type: 'conflict',
          current_updated_at: note.updatedAt,
          your_updated_at: body.if_updated_at,
          path: note.path,
          note_id: note.id,
          message: `Note "${note.id}" was modified at ${note.updatedAt} (you expected ${body.if_updated_at})`,
          error: 'conflict',
          expected_updated_at: body.if_updated_at,
        })
      }
      if (body.content !== undefined) note.content = body.content
      if (body.metadata !== undefined) {
        note.metadata = { ...note.metadata, ...body.metadata }
      }
      if (body.tags?.add?.length) {
        for (const t of body.tags.add) {
          if (!note.tags.includes(t)) note.tags.push(t)
        }
      }
      if (body.tags?.remove?.length) {
        note.tags = note.tags.filter((t) => !body.tags.remove.includes(t))
      }
      note.updatedAt = nextStamp()
      return json(res, 200, { ...note, created: false })
    }

    if (req.method === 'DELETE') {
      if (!note) return json(res, 404, { error: 'Not found' })
      notes = notes.filter((n) => n !== note)
      return json(res, 200, { deleted: true, id: note.id })
    }

    return json(res, 405, { error: 'Method not allowed' })
  }

  json(res, 404, { error: 'Not found' })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock vault listening on http://127.0.0.1:${PORT}`)
  console.log(`  token: ${TOKEN}`)
})
