import { useState } from 'react'
import { LAYERS, layerAccent } from './layers'

// The interactive eight-layer stack — Module 0's mental model made clickable.
// Authored in MDX as:
//   <LayerStack />                  full stack, click any layer to expand
//   <LayerStack highlight="tools" /> spotlight one layer (e.g. in Module 4)
// Coloured blue (start) → gold (mastery) down the stack, per the series axis.

export function LayerStack({ highlight }: { highlight?: string }) {
  const spotlight = highlight?.trim().toLowerCase()
  const [open, setOpen] = useState<string | null>(null)

  return (
    <div className="mdx-stack" role="list" aria-label="The eight-layer stack">
      {LAYERS.map((layer, i) => {
        const isSpot = spotlight === layer.id || spotlight === layer.name.toLowerCase()
        const isOpen = open === layer.id
        const accent = layerAccent(i, LAYERS.length)
        return (
          <div
            key={layer.id}
            role="listitem"
            className={`mdx-stack-row${isSpot ? ' is-spotlight' : ''}${isOpen ? ' is-open' : ''}`}
            style={{ ['--layer-accent' as string]: accent }}
          >
            <button
              type="button"
              className="mdx-stack-bar"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : layer.id)}
            >
              <span className="mdx-stack-n">{layer.n}</span>
              <span className="mdx-stack-name">{layer.name}</span>
              <span className="mdx-stack-rig">{layer.rig}</span>
            </button>
            {isOpen && (
              <div className="mdx-stack-detail">
                <p>{layer.what}</p>
                <p className="mdx-stack-eg">
                  e.g. <code>{layer.buzzword}</code> lives here
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
