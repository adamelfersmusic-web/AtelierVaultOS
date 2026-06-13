// parachute-scribe transcription wrapper for the editor's /voice block. Scribe
// is a SEPARATE service (default http://localhost:1943, or a tailnet/funnel
// URL) — its base URL is ALWAYS a setting, never hardcoded. Scribe sends CORS
// headers, so the browser calls it directly. We do NOT rebuild transcription;
// we hand it a recorded blob and read back { text }.

export class ScribeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScribeError'
  }
}

export interface TranscribeInput {
  blob: Blob
  baseUrl: string
  model: string
  token?: string
  cleanup?: boolean
  /** Forward hook (not MVP): proper-noun context to improve cleanup. */
  context?: string
}

function base(url: string): string {
  return url.replace(/\/+$/, '')
}

export async function transcribe(input: TranscribeInput): Promise<string> {
  const { blob, baseUrl, model, token, cleanup, context } = input
  if (!baseUrl) throw new ScribeError('No scribe URL set.')

  const form = new FormData()
  form.append('file', blob, 'recording.webm')
  form.append('model', model)
  if (cleanup) form.append('cleanup', 'true')
  // Clean seam for the future proper-nouns context part.
  if (context) form.append('context', context)

  let res: Response
  try {
    res = await fetch(`${base(baseUrl)}/v1/audio/transcriptions`, {
      method: 'POST',
      // No Content-Type — the browser sets the multipart boundary itself.
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    })
  } catch (e) {
    throw new ScribeError(
      `Couldn't reach scribe at ${baseUrl} — ${
        e instanceof Error ? e.message : String(e)
      }`,
    )
  }

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    // 401 shape: { error: "unauthorized", message: "..." }
    const d = data as { message?: string; error?: string } | null
    throw new ScribeError(
      d?.message || d?.error || `${res.status} ${res.statusText}`,
    )
  }
  const text = (data as { text?: unknown })?.text
  if (typeof text !== 'string' || !text.trim()) {
    throw new ScribeError('Scribe returned no transcription.')
  }
  return text.trim()
}

/** Populate the model picker from GET <scribeUrl>/v1/models (best-effort). */
export async function listScribeModels(
  baseUrl: string,
  token?: string,
): Promise<string[]> {
  if (!baseUrl) return []
  const res = await fetch(`${base(baseUrl)}/v1/models`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  })
  if (!res.ok) throw new ScribeError(`${res.status} ${res.statusText}`)
  const data = (await res.json()) as {
    data?: unknown[]
    models?: unknown[]
  }
  const list = data?.data ?? data?.models ?? []
  return (Array.isArray(list) ? list : [])
    .map((m) => (typeof m === 'string' ? m : (m as { id?: string })?.id))
    .filter((x): x is string => typeof x === 'string')
}
