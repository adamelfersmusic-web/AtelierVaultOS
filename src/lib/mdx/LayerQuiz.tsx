import { useState } from 'react'
import { LAYERS, findLayer } from './layers'

// The diagnostic drill — the single highest-leverage habit in the whole
// primer ("when a buzzword shows up, ask: which layer is this?"), turned into
// a game. Authored in MDX as:
//   <LayerQuiz term="MCP" answer="Tools" />
// Shows the buzzword, lets the learner pick a layer, then grades and explains.

export function LayerQuiz({ term, answer }: { term?: string; answer?: string }) {
  const correct = answer ? findLayer(answer) : undefined
  const [picked, setPicked] = useState<string | null>(null)

  // Malformed authoring (no term, or an answer that names no layer) degrades
  // to nothing rather than crashing the note.
  if (!term || !correct) return null

  const solved = picked === correct.id
  return (
    <div className="mdx-quiz" role="group" aria-label={`Which layer is ${term}?`}>
      <div className="mdx-quiz-q">
        Which layer is <strong>{term}</strong>?
      </div>
      <div className="mdx-quiz-options">
        {LAYERS.map((layer) => {
          const isPicked = picked === layer.id
          const state =
            picked === null
              ? ''
              : layer.id === correct.id
                ? ' is-correct'
                : isPicked
                  ? ' is-wrong'
                  : ' is-dim'
          return (
            <button
              key={layer.id}
              type="button"
              className={`mdx-quiz-opt${state}`}
              disabled={picked !== null}
              onClick={() => setPicked(layer.id)}
            >
              {layer.name}
            </button>
          )
        })}
      </div>
      {picked !== null && (
        <div className={`mdx-quiz-verdict${solved ? ' is-win' : ''}`} role="status">
          <strong>{solved ? 'Correct.' : `Not quite — it's ${correct.name}.`}</strong>{' '}
          {term} lives in layer {correct.n}: {correct.what}
          {!solved && (
            <button
              type="button"
              className="mdx-quiz-retry"
              onClick={() => setPicked(null)}
            >
              Try again
            </button>
          )}
        </div>
      )}
    </div>
  )
}
