// The /ai block — an interactive, async NodeView. Slash `/ai` inserts it; the
// user types a question; on submit it queries Anthropic (grounded with vault
// notes via client-side RAG) and inserts the answer as NEW markdown blocks below,
// then collapses itself into a small "asked: …" record. It never persists as
// an exotic node: its markdown form is a plain blockquote of the question, and
// the answer is ordinary paragraphs/quotes.

import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import type { JSONContent, NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { useEditorSettings, openPagesSettings } from '../../lib/editorSettings'
import { askVault, AnthropicError } from '../../lib/anthropic'
import { toast } from '../../lib/store'
import { IconSpark, IconClose } from '../../components/Icons'

// Split the model's plain-prose answer into separate paragraph block nodes —
// one block per logical paragraph, so ideas aren't collapsed into a single
// run. The system prompt asks Claude for plain prose, so we split on blank
// lines (true paragraph breaks); a response with no blank lines falls back to
// single newlines. Plain-text nodes carry no marks, so they can never hit the
// schema's "invalid collection of marks" errors.
function toParagraphBlocks(answer: string): JSONContent[] {
  const trimmed = answer.replace(/\r\n?/g, '\n').trim()
  let parts = trimmed.split(/\n[ \t]*\n+/)
  if (parts.length === 1) parts = trimmed.split(/\n+/)
  const paragraphs = parts
    // Join soft-wrapped lines within a paragraph into one run.
    .map((p) => p.replace(/[ \t]*\n[ \t]*/g, ' ').trim())
    .filter((p) => p.length > 0)
  const blocks = paragraphs.length ? paragraphs : [trimmed]
  return blocks.map((text) => ({
    type: 'paragraph',
    content: text ? [{ type: 'text', text }] : [],
  }))
}

function AiBlockView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const settings = useEditorSettings()
  const asked = !!node.attrs.asked
  const [prompt, setPrompt] = useState<string>((node.attrs.prompt as string) || '')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'fading' | 'error'>(
    'idle',
  )
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!asked) inputRef.current?.focus()
  }, [asked])

  const submit = async () => {
    const q = prompt.trim()
    if (!q || phase === 'loading') return
    if (!settings.anthropicKey) {
      toast('info', 'Add your Anthropic API key in Settings to use /ai.', {
        label: 'Open settings',
        run: () => openPagesSettings(),
      })
      return
    }
    setPhase('loading')
    setError(null)
    try {
      const answer = await askVault({
        prompt: q,
        apiKey: settings.anthropicKey,
      })
      // Fade the thinking monogram out (0.3s) before the answer appears.
      setPhase('fading')
      await new Promise((resolve) => setTimeout(resolve, 300))
      // Insert the answer as separate plain-text paragraph blocks — one block
      // per logical paragraph, with spacing between them. Plain-text nodes carry
      // no marks, so they can't hit the schema's invalid-mark errors.
      const blocks = toParagraphBlocks(answer)
      const pos = getPos()
      if (typeof pos === 'number') {
        editor.chain().focus().insertContentAt(pos + node.nodeSize, blocks).run()
      } else {
        editor.chain().focus().insertContent(blocks).run()
      }
      // Collapse to a small "asked" record.
      updateAttributes({ prompt: q, asked: true })
      setPhase('idle')
    } catch (e) {
      const msg =
        e instanceof AnthropicError || e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhase('error')
      toast('error', `AI failed — ${msg}`)
    }
  }

  if (asked) {
    return (
      <NodeViewWrapper className="ai-block ai-block-asked">
        <div className="ai-asked" contentEditable={false}>
          <IconSpark size={13} />
          <span className="ai-asked-text">asked: {node.attrs.prompt as string}</span>
          <button className="ai-asked-x" title="Remove" onClick={() => deleteNode()}>
            <IconClose size={12} />
          </button>
        </div>
      </NodeViewWrapper>
    )
  }

  return (
    <NodeViewWrapper className="ai-block">
      <div className="ai-prompt" contentEditable={false}>
        <div className="ai-prompt-head">
          <IconSpark size={13} />
          Ask the vault
        </div>
        <textarea
          ref={inputRef}
          className="ai-input"
          placeholder="Ask a question — answered from your notes…"
          value={prompt}
          disabled={phase === 'loading' || phase === 'fading'}
          rows={2}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              deleteNode()
            }
          }}
        />
        {error && <div className="ai-error">{error}</div>}
        {phase === 'loading' || phase === 'fading' ? (
          <div className="ai-thinking" role="status" aria-label="Thinking">
            <span
              className={`ai-monogram${phase === 'fading' ? ' is-leaving' : ''}`}
            >
              G.
            </span>
          </div>
        ) : (
          <div className="ai-actions">
            <button className="btn btn-ghost" onClick={() => deleteNode()}>
              Cancel
            </button>
            <button
              className="btn btn-gold"
              disabled={!prompt.trim()}
              onClick={() => void submit()}
            >
              Ask <kbd>⌘↵</kbd>
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  )
}

export const AiBlock = Node.create({
  name: 'aiBlock',
  group: 'block',
  atom: false,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      prompt: { default: '' },
      asked: { default: false },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-ai-block]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-ai-block': '' })]
  },

  addNodeView() {
    return ReactNodeViewRenderer(AiBlockView)
  },

  renderMarkdown: (node) => {
    const asked = !!node.attrs?.asked
    const prompt = String(node.attrs?.prompt ?? '').trim()
    // Persist the asked record as a plain blockquote; an un-asked prompt simply
    // vanishes. The answer lives as its own real blocks, inserted on submit.
    return asked && prompt ? `> **Asked AI:** ${prompt}` : ''
  },
})
