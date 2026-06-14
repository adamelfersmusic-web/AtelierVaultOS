// Direct browser → Anthropic Messages API for the editor's /ai block. No SDK:
// a single fetch, MCP-connected to the live vault so answers are grounded in
// the user's notes. The API key is the user's own, read from client-side
// settings at call time — it is never bundled, committed, or sent anywhere
// but api.anthropic.com.

import { toast } from './store'

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-6'
const SYSTEM =
  'You are connected to a knowledge vault. Answer questions by querying the ' +
  'vault first. Cite note titles when relevant.'

export interface AskVaultInput {
  prompt: string
  apiKey: string
  /** The connected vault's MCP endpoint, e.g. https://hub/vault/jonathan/mcp. */
  mcpUrl: string | null
  /** Vault access token authorizing the MCP server (may be under-scoped). */
  mcpToken: string | null
  /** Human-readable MCP server name, derived from the vault (e.g. jonathan-vault). */
  mcpName?: string
}

export class AnthropicError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AnthropicError'
  }
}

/**
 * One Messages API round-trip. `extra` is merged into the request body — used
 * to add the MCP connector (the `mcp_servers` declaration plus the `tools`
 * entry that references it) on the vault-grounded attempt, and omitted on the
 * plain fallback.
 */
async function requestMessages(
  apiKey: string,
  prompt: string,
  extra: Record<string, unknown>,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 1000,
    system: SYSTEM,
    messages: [{ role: 'user', content: prompt }],
    ...extra,
  }

  let res: Response
  try {
    res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'mcp-client-2025-11-20',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
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

  // Parse by block type, not position: assemble every `text` block, tolerating
  // interleaved mcp_tool_use / mcp_tool_result blocks in the content array.
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
  const { prompt, apiKey, mcpUrl, mcpToken, mcpName } = input
  if (!apiKey) throw new AnthropicError('No Anthropic API key set.')

  // Vault-grounded attempt: declare the MCP server in `mcp_servers` AND
  // reference it with an `mcp_toolset` entry in `tools`. The connector
  // (mcp-client-2025-11-20) requires both, and the toolset link field is
  // `mcp_server_name` with type `mcp_toolset` — a declared server with no
  // matching toolset is rejected ("MCP server '…' is defined but not
  // referenced by any mcp_toolset in tools"). The same server name is used in
  // both places so they always match. Anthropic's servers make the MCP
  // connection; `authorization_token` is the vault's OAuth access token.
  if (mcpUrl) {
    const serverName = mcpName || 'vault'
    try {
      return await requestMessages(apiKey, prompt, {
        mcp_servers: [
          {
            type: 'url',
            url: mcpUrl,
            name: serverName,
            // TODO: MCP token scope — confirm with Aaron that the vault's REST
            // access token authorizes the /mcp endpoint.
            ...(mcpToken ? { authorization_token: mcpToken } : {}),
          },
        ],
        tools: [{ type: 'mcp_toolset', mcp_server_name: serverName }],
      })
    } catch (e) {
      // Vault grounding failed (e.g. MCP auth scope, server unreachable) —
      // retry without it so /ai always answers instead of failing hard. A
      // genuine error from the plain call still propagates. The console line
      // makes a persistent MCP failure visible in devtools.
      console.warn('[ai] vault MCP grounding failed; answering without it:', e)
      const answer = await requestMessages(apiKey, prompt, {})
      toast('info', 'Answered without vault context.')
      return answer
    }
  }

  return requestMessages(apiKey, prompt, {})
}

/** Derive the MCP server config from a connected vault base URL. */
export function mcpFromVaultBase(
  base: string | null,
): { url: string; name: string } | null {
  if (!base) return null
  const clean = base.replace(/\/+$/, '')
  const seg = clean.split('/').filter(Boolean).pop()
  return { url: `${clean}/mcp`, name: seg ? `${seg}-vault` : 'vault' }
}
