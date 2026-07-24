// Live glossary resolution: <Term> pulls its definition from the real
// ai-primer-glossary note in the vault, over REST, at read time. Edit the
// glossary once and every <Term> across every module updates itself.
//
// The glossary note is plain markdown, one term per line:
//   - **Context window** — the model's working memory... → [[link]]
// We fetch it once (memoised), strip the trailing "→ [[link]]", and index
// each entry under several keys so an author can write id="mcp",
// id="context-window", etc.

import { fetchNote } from '../store'

const GLOSSARY_PATH = 'Atelier/Method/ai-primer/ai-primer-glossary'
const LINE = /^-\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Every key an author might reference this term by. "MCP (Model Context
 * Protocol)" → mcp-model-context-protocol, mcp, model-context-protocol. */
function keysFor(name: string): string[] {
  const keys = new Set<string>([slug(name)])
  const paren = name.match(/^(.*?)\s*\((.+)\)\s*$/)
  if (paren) {
    if (paren[1]) keys.add(slug(paren[1]))
    if (paren[2]) keys.add(slug(paren[2]))
  }
  return [...keys].filter(Boolean)
}

function parse(content: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const raw of content.split('\n')) {
    const m = raw.match(LINE)
    if (!m) continue
    const name = m[1].trim()
    // Drop the trailing "→ [[module-link]]" pointer, keep the definition.
    const def = m[2].split('→')[0].replace(/\[\[|\]\]/g, '').trim()
    if (!def) continue
    for (const k of keysFor(name)) if (!map.has(k)) map.set(k, def)
  }
  return map
}

let cache: Promise<Map<string, string>> | null = null

function loadGlossary(): Promise<Map<string, string>> {
  if (!cache) {
    cache = fetchNote(GLOSSARY_PATH)
      .then((note) => parse(note?.content ?? ''))
      .catch(() => {
        // A failed fetch shouldn't poison the cache — let the next term retry.
        cache = null
        return new Map<string, string>()
      })
  }
  return cache
}

/** Resolve a term id to its live vault definition, or null if not found. */
export async function resolveDefinition(id: string): Promise<string | null> {
  const map = await loadGlossary()
  return map.get(slug(id)) ?? null
}
