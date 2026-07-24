import { useEffect, useState, type ReactNode } from 'react'
import { resolveDefinition } from './glossary'

// A glossary term inside prose: dotted underline, click to expand a
// definition panel beneath the sentence.
//
// Definitions are pulled LIVE from the vault's ai-primer-glossary note over
// REST (see ./glossary). A tiny local map is kept only as an offline
// fallback so the component still works if the glossary can't be reached.
const FALLBACK: Record<string, string> = {
  'context-window':
    'The span of text a model can consider at once — the prompt plus its own output so far. Layer two of the primer.',
}

type State =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'done'; text: string; source: 'vault' | 'local' | 'missing' }

export function Term({ id, children }: { id?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<State>({ phase: 'idle' })
  const panelId = id ? `term-def-${id}` : undefined

  // Resolve the definition the first time the term is opened. Depends only on
  // open/id — putting phase here would let the loading transition cancel its
  // own in-flight fetch.
  useEffect(() => {
    if (!open) return
    if (!id) {
      setState({ phase: 'done', text: '', source: 'missing' })
      return
    }
    let cancelled = false
    setState((prev) => (prev.phase === 'done' ? prev : { phase: 'loading' }))
    const fallback = (): State =>
      FALLBACK[id]
        ? { phase: 'done', text: FALLBACK[id], source: 'local' }
        : { phase: 'done', text: '', source: 'missing' }
    resolveDefinition(id)
      .then((vaultDef) => {
        if (cancelled) return
        setState(vaultDef ? { phase: 'done', text: vaultDef, source: 'vault' } : fallback())
      })
      .catch(() => {
        if (!cancelled) setState(fallback())
      })
    return () => {
      cancelled = true
    }
  }, [open, id])

  return (
    <span className="mdx-term-wrap">
      <button
        type="button"
        className="mdx-term"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {children}
      </button>
      {open && (
        <span id={panelId} className="mdx-term-def" role="note">
          {state.phase === 'loading' && <em>Looking it up…</em>}
          {state.phase === 'done' && state.source === 'missing' && (
            <em>No definition in the glossary{id ? ` for “${id}”` : ''}.</em>
          )}
          {state.phase === 'done' && state.source !== 'missing' && (
            <>
              {state.text}
              {state.source === 'vault' && (
                <span className="mdx-term-src"> — from your glossary</span>
              )}
            </>
          )}
        </span>
      )}
    </span>
  )
}
