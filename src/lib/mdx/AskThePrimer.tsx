import { useState } from 'react'
import { askPrimer, AnthropicError, type AskPrimerResult } from '../anthropic'
import { useEditorSettings, openPagesSettings } from '../editorSettings'

// <AskThePrimer /> — a Claude box scoped to the AI: Zero to Hero course.
// Reuses the app's browser-direct Anthropic wiring (the user's own key from
// editor settings) but grounds every answer in the whole ai-primer and cites
// the modules it drew from. A textbook you can interrogate, dropped into a note.

function paragraphs(text: string): string[] {
  const t = text.replace(/\r\n?/g, '\n').trim()
  const parts = t.split(/\n[ \t]*\n+/)
  return (parts.length > 1 ? parts : t.split(/\n+/))
    .map((p) => p.replace(/[ \t]*\n[ \t]*/g, ' ').trim())
    .filter(Boolean)
}

export function AskThePrimer({ placeholder }: { placeholder?: string }) {
  const settings = useEditorSettings()
  const [prompt, setPrompt] = useState('')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AskPrimerResult | null>(null)

  const submit = async () => {
    const q = prompt.trim()
    if (!q || phase === 'loading') return
    if (!settings.anthropicKey) {
      setError('Add your Anthropic API key in Settings to ask the primer.')
      setPhase('error')
      return
    }
    setPhase('loading')
    setError(null)
    setResult(null)
    try {
      setResult(await askPrimer({ prompt: q, apiKey: settings.anthropicKey }))
      setPhase('idle')
    } catch (e) {
      setError(e instanceof AnthropicError || e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <div className="mdx-ask" contentEditable={false}>
      <div className="mdx-ask-head">✦ Ask the primer</div>
      <textarea
        className="mdx-ask-input"
        placeholder={placeholder || 'Ask anything about the course — answered from the modules…'}
        value={prompt}
        rows={2}
        disabled={phase === 'loading'}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      <div className="mdx-ask-actions">
        {!settings.anthropicKey && (
          <button className="mdx-ask-key" onClick={() => openPagesSettings()}>
            Set API key
          </button>
        )}
        <button
          className="mdx-ask-go"
          disabled={!prompt.trim() || phase === 'loading'}
          onClick={() => void submit()}
        >
          {phase === 'loading' ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      {error && <div className="mdx-ask-error">{error}</div>}

      {result && (
        <div className="mdx-ask-answer" role="status">
          {paragraphs(result.answer).map((p, i) => (
            <p key={i}>{p}</p>
          ))}
          {result.sources.length > 0 && (
            <div className="mdx-ask-sources">
              Grounded in {result.sources.length} course notes
            </div>
          )}
        </div>
      )}
    </div>
  )
}
