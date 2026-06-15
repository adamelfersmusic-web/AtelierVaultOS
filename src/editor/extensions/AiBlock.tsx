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

// Flatten parsed markdown to plain-text paragraph blocks. Claude's answers can
// combine marks (e.g. code+italic) or use blocks the editor schema rejects on
// insert ("Invalid collection of marks for node text: code,italic"). Reducing
// to bare paragraphs always inserts cleanly — the content is preserved; only
// inline styling and exotic block types are dropped.
function plainTextBlocks(doc: JSONContent | undefined, fallback: string): JSONContent[] {
  const textOf = (n: JSONContent): string =>
    n.type === 'text' ? (n.text ?? '') : (n.content ?? []).map(textOf).join('')

  const lines: string[] = []
  const walk = (n: JSONContent): void => {
    switch (n.type) {
      case 'bulletList':
      case 'orderedList':
        for (const item of n.content ?? []) {
          const t = textOf(item).trim()
          if (t) lines.push(`• ${t}`)
        }
        return
      case 'paragraph':
      case 'heading':
      case 'blockquote':
      case 'codeBlock': {
        const t = textOf(n).trim()
        if (t) lines.push(t)
        return
      }
      default:
        // Tables, dividers, images, etc.: recurse so any text inside survives.
        for (const child of n.content ?? []) walk(child)
    }
  }

  for (const n of doc?.content ?? []) walk(n)
  const blocks = lines.length ? lines : [fallback.trim()]
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
      // Insert the answer as plain-text blocks. Claude's markdown can contain
      // mark combos (e.g. code+italic) or blocks the editor can't render, which
      // throw "Invalid collection of marks…" on insert; flattening to plain
      // paragraphs always inserts cleanly.
      let parsed: JSONContent | undefined
      try {
        parsed = editor.markdown?.parse(answer)
      } catch {
        parsed = undefined
      }
      const blocks = plainTextBlocks(parsed, answer)
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
