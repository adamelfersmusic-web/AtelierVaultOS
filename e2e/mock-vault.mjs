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
import { makeSeed, TAGS } from './seed.mjs'

const PORT = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 8787
const TOKEN = 'atelier-test-token'

let notes = makeSeed()
let lastTs = Date.now()
let idSeq = 900000

const nextStamp = () => {
  lastTs = Math.max(Date.now(), lastTs + 1)
  return new Date(lastTs).toISOString()
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
}

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...CORS })
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

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    return res.end()
  }

  // ——— test control plane (no auth) ———
  if (path === '/__test/reset' && req.method === 'POST') {
    notes = makeSeed()
    return json(res, 200, { ok: true })
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

  // ——— auth ———
  const auth = req.headers.authorization ?? ''
  if (auth !== `Bearer ${TOKEN}`) {
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
      return json(res, 200, includeContent ? out : out.map(lean))
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
