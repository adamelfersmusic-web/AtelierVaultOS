// The eight-layer stack — the spine of the AI: Zero to Hero primer, straight
// from ai-primer-00-mental-model. This is canonical course content, so it
// lives in code and powers every course component (LayerStack, LayerQuiz).
//
// The progression axis is blue (start) → gold (mastery), per the series
// identity note — the components colour the stack along that axis by index.

export interface Layer {
  n: number
  id: string
  name: string
  /** Plain-English one-liner. */
  what: string
  /** The production-rig analogy from Module 0. */
  rig: string
  /** A buzzword that resolves to this layer — fuel for the diagnostic drill. */
  buzzword: string
}

export const LAYERS: Layer[] = [
  {
    n: 1,
    id: 'model',
    name: 'Model',
    what: 'The trained neural network. The brain.',
    rig: 'The instrument.',
    buzzword: 'GPT-4 / Claude Opus',
  },
  {
    n: 2,
    id: 'context-window',
    name: 'Context window',
    what: 'Short-term working memory for this one conversation.',
    rig: 'How much the instrument can hear at once.',
    buzzword: '128k tokens',
  },
  {
    n: 3,
    id: 'system-prompt',
    name: 'System prompt',
    what: 'Invisible instructions the company or developer sets before you type.',
    rig: 'The house settings on the board.',
    buzzword: 'guardrails',
  },
  {
    n: 4,
    id: 'user-prompt',
    name: 'User prompt',
    what: 'What you actually ask.',
    rig: 'What you play.',
    buzzword: 'chain of thought',
  },
  {
    n: 5,
    id: 'tools',
    name: 'Tools',
    what: 'Things the model can call: search the web, run code, read a file, hit an API.',
    rig: 'Pedals and outboard gear bolted on.',
    buzzword: 'MCP',
  },
  {
    n: 6,
    id: 'memory',
    name: 'Memory',
    what: 'Long-term storage that persists across conversations. Not the context window.',
    rig: 'What it remembers between sessions.',
    buzzword: 'memory',
  },
  {
    n: 7,
    id: 'orchestration',
    name: 'Orchestration / agent loop',
    what: 'Logic that lets the model take multiple steps and decide what is next without a human clicking go.',
    rig: 'The whole rig running itself.',
    buzzword: 'agent',
  },
  {
    n: 8,
    id: 'interface',
    name: 'Interface',
    what: 'The chat app, Slack bot, browser extension, or phone app on top.',
    rig: 'The skin over everything.',
    buzzword: 'Claude in Slack',
  },
]

/** Blue (start) → gold (mastery) across the stack, by zero-based index. */
export function layerAccent(index: number, total: number): string {
  const t = total <= 1 ? 0 : index / (total - 1)
  return `color-mix(in oklab, var(--blue) ${Math.round((1 - t) * 100)}%, var(--gold))`
}

/** Resolve an answer string (name or id, any case) to a layer. */
export function findLayer(answer: string): Layer | undefined {
  const a = answer.trim().toLowerCase()
  return LAYERS.find(
    (l) => l.id === a || l.name.toLowerCase() === a || l.name.toLowerCase().startsWith(a),
  )
}
