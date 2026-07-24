import { useState, type ReactNode } from 'react'

// A glossary term inside prose: dotted underline, click to expand a
// definition panel beneath the sentence. This is the one component wired
// end to end for the MDX runtime-rendering test.
//
// Definitions live in a small local map for now — enough to prove the
// render + expand path against the ai-primer test note. Swapping this for a
// real source (a vault `definitions/` lookup, a prop, an API) is a one-line
// change to `defineTerm` and does not touch the render.
const DEFINITIONS: Record<string, string> = {
  'context-window':
    'The span of text a model can consider at once — the prompt plus its own output so far. When it fills, the oldest tokens fall out of view. Layer two of the primer.',
}

function defineTerm(id: string): string | null {
  return DEFINITIONS[id] ?? null
}

export function Term({
  id,
  children,
}: {
  id?: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const definition = id ? defineTerm(id) : null
  const panelId = id ? `term-def-${id}` : undefined

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
          {definition ?? (
            <em>No definition registered{id ? ` for “${id}”` : ''}.</em>
          )}
        </span>
      )}
    </span>
  )
}
