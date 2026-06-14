// The /ai block — an interactive, async NodeView. Slash `/ai` inserts it; the
// user types a question; on submit it queries Anthropic (MCP-connected to the
// live vault) and inserts the answer as NEW markdown blocks directly below,
// then collapses itself into a small "asked: …" record. It never persists as
// an exotic node: its markdown form is a plain blockquote of the question, and
// the answer is ordinary paragraphs/quotes.

import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import type { NodeViewProps } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import { useEditorSettings, openPagesSettings } from '../../lib/editorSettings'
import { askVault, mcpFromVaultBase, AnthropicError } from '../../lib/anthropic'
import { toast, vaultAccessToken, vaultBaseUrl } from '../../lib/store'
import { IconSpark, IconClose } from '../../components/Icons'

function AiBlockView({ node, updateAttributes, deleteNode, editor, getPos }: NodeViewProps) {
  const settings = useEditorSettings()
  const asked = !!node.attrs.asked
  const [prompt, setPrompt] = useState<string>((node.attrs.prompt as string) || '')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle')
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
      const mcp = mcpFromVaultBase(vaultBaseUrl())
      const token = await vaultAccessToken()
      const answer = await askVault({
        prompt: q,
        apiKey: settings.anthropicKey,
        mcpUrl: mcp?.url ?? null,
        mcpName: mcp?.name,
        mcpToken: token,
      })
      // Insert the answer as its own real blocks, directly below this node.
      const pos = getPos()
      if (typeof pos === 'number') {
        editor
          .chain()
          .focus()
          .insertContentAt(pos + node.nodeSize, answer, { contentType: 'markdown' })
          .run()
      } else {
        editor.chain().focus().insertContent(answer, { contentType: 'markdown' }).run()
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
          disabled={phase === 'loading'}
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
        <div className="ai-actions">
          <button className="btn btn-ghost" onClick={() => deleteNode()}>
            Cancel
          </button>
          <button
            className="btn btn-gold"
            disabled={!prompt.trim() || phase === 'loading'}
            onClick={() => void submit()}
          >
            {phase === 'loading' ? (
              'Thinking…'
            ) : (
              <>
                Ask <kbd>⌘↵</kbd>
              </>
            )}
          </button>
        </div>
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
