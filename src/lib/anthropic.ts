// Direct browser → Anthropic Messages API for the editor's /ai block. The
// answer is grounded with client-side RAG: before calling Claude we search the
// vault's REST API (the same authenticated session that powers Scripts and
// Graph) for relevant notes and inject them into the system prompt as context.
// No SDK and no MCP round-trip — a single fetch to api.anthropic.com with the
// user's own key, read from client-side settings at call time.

import { mostLinkedContext, searchVaultContext, toast } from './store'
import { titleFromPath } from './format'
import type { Note } from './types'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'

const SYSTEM =
  "You are Jonathan Gaietto's personal brand AI. You have access to his " +
  'complete knowledge vault; the notes most relevant to this question are ' +
  'provided below. You MUST ground every answer in those notes — never answer ' +
  'from general knowledge alone. Always cite the specific vault notes you drew ' +
  "from. If the notes don't contain the answer, say so plainly rather than " +
  'guessing. Write all responses in clean plain prose. No markdown formatting ' +
  '— no asterisks, no pound signs, no dashes as bullets. Use natural paragraph ' +
  'breaks to separate ideas. Write like a thoughtful human, not a formatted ' +
  'document.'

// Retrieval tuning: a baseline of the most-linked hubs plus keyword matches.
const BASELINE_N = 20 // most-linked notes fetched on every query
const SEARCH_LIMIT = 50 // keyword search breadth
const TOP_N = 15 // max keyword matches added on top of the baseline
const MAX_BODY_CHARS = 1800

export interface AskVaultInput {
  prompt: string
  apiKey: string
}

export class AnthropicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnthropicError'
  }
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'at', 'by', 'from', 'about', 'as', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'it', 'its', 'this', 'that', 'these', 'those', 'what', 'who', 'whom',
  'whose', 'which', 'when', 'where', 'why', 'how', 'do', 'does', 'did', 'can',
  'could', 'would', 'should', 'will', 'tell', 'me', 'my', 'our', 'us', 'i',
  'you', 'your', 'please', 'give', 'show', 'explain', 'into', 'over', 'than',
  'then', 'so', 'his', 'her', 'their', 'they', 'he', 'she',
])

/** Reduce a natural-language question to vault full-text search keywords. */
function keywords(prompt: string): string {
  const seen = new Set<string>()
  const terms: string[] = []
  for (const w of prompt.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/)) {
    if (w.length >= 2 && !STOPWORDS.has(w) && !seen.has(w)) {
      seen.add(w)
      terms.push(w)
    }
  }
  // Fall back to the raw prompt if stripping left nothing meaningful.
  return terms.length ? terms.join(' ') : prompt.trim()
}

/** Render retrieved notes as a context block: title, path, tags, bounded body. */
function contextBlock(notes: Note[]): string {
  if (notes.length === 0) {
    return 'No relevant vault notes were found for this question.'
  }
  return notes
    .map((n) => {
      const tags = n.tags.length ? n.tags.join(', ') : '—'
      let body = (n.content ?? '').trim()
      if (body.length > MAX_BODY_CHARS) body = `${body.slice(0, MAX_BODY_CHARS)}…`
      return `## ${titleFromPath(n.path)}\nPath: ${n.path}\nTags: ${tags}\n\n${body}`
    })
    .join('\n\n---\n\n')
}

async function requestMessages(
  apiKey: string,
  system: string,
  prompt: string,
): Promise<string> {
  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (e) {
    throw new AnthropicError(
      `Couldn't reach Anthropic — ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    const d = data as { error?: { message?: string }; message?: string } | null
    const msg =
      d?.error?.message || d?.message || `${res.status} ${res.statusText}`
    throw new AnthropicError(msg)
  }

  // Assemble every `text` block from the response (ignore non-text blocks).
  const content = (data as { content?: unknown })?.content
  const blocks = Array.isArray(content) ? content : []
  const text = blocks
    .filter(
      (b): b is { type: string; text: string } =>
        !!b && b.type === 'text' && typeof b.text === 'string',
    )
    .map((b) => b.text)
    .join('\n\n')
    .trim()
  if (!text) throw new AnthropicError('The model returned no text answer.')
  return text
}

export async function askVault(input: AskVaultInput): Promise<string> {
  const { prompt, apiKey } = input
  if (!apiKey) throw new AnthropicError('No Anthropic API key set.')

  // Client-side RAG. Two retrievals run together, both over the active
  // authenticated session (the API that powers Scripts and Graph):
  //   • BASELINE — the most-linked notes (the vault's hubs). Always fetched, so
  //     even a vague query whose keywords match nothing still has real context.
  //   • KEYWORD — notes matching the question's keywords, layered on top.
  const [baseRes, kwRes] = await Promise.allSettled([
    mostLinkedContext(BASELINE_N),
    searchVaultContext(keywords(prompt), SEARCH_LIMIT),
  ])
  const baseline = baseRes.status === 'fulfilled' ? baseRes.value : []
  const matches = kwRes.status === 'fulfilled' ? kwRes.value : []

  // Keyword matches first (most query-relevant), then the baseline hubs;
  // dedupe by path and cap the keyword additions.
  const seen = new Set(baseline.map((n) => n.path))
  const extra = matches.filter((n) => !seen.has(n.path)).slice(0, TOP_N)
  const notes = [...extra, ...baseline]

  if (baseRes.status === 'rejected') {
    console.warn('[ai] baseline (most-linked) retrieval failed:', baseRes.reason)
  }
  if (baseRes.status === 'rejected' && kwRes.status === 'rejected') {
    toast('info', 'Answered without vault context.')
  }

  const system = `${SYSTEM}\n\n# Vault context\n\n${contextBlock(notes)}`
  return requestMessages(apiKey, system, prompt)
}
