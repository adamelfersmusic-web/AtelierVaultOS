import { useMemo, useState } from 'react'
import { createScript, toast } from '../lib/store'
import { closeNewScript } from '../lib/ui'
import { navigate } from '../lib/router'
import { slugify } from '../lib/format'
import { SCRIPTS_DB, fieldByKey } from '../domain/scripts'
import { Modal } from '../components/Modal'
import { ChipSelect } from '../components/EnumMenu'
import type { NoteMetadata } from '../lib/types'

const QUICK_FIELDS = ['status', 'pillar', 'source', 'conviction', 'cta_level']

export function NewScriptModal() {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [meta, setMeta] = useState<NoteMetadata>({
    status: 'idea',
    source: 'brainstorm',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const slug = useMemo(() => slugify(title), [title])

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!title.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const note = await createScript({ title: title.trim(), body, metadata: meta })
      closeNewScript()
      toast('success', `Captured — ${note.path}`)
      navigate({ kind: 'note', path: note.path })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={closeNewScript} width={560} labelledBy="new-script-title">
      <form className="capture" onSubmit={submit}>
        <h2 id="new-script-title" className="capture-heading">
          New script
        </h2>
        <input
          autoFocus
          className="capture-title"
          placeholder="Name the moment — “The Fake Map”"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          data-testid="capture-title"
        />
        <div className="capture-path">
          {SCRIPTS_DB.newNote.pathPrefix}
          <strong>{slug || '…'}</strong>
        </div>
        <textarea
          className="capture-body"
          placeholder="First lines, a hook, a half-thought — optional"
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void submit()
          }}
          data-testid="capture-body"
        />
        <div className="capture-quick">
          {QUICK_FIELDS.map((key) => {
            const f = fieldByKey(key)
            if (!f) return null
            return (
              <div className="prop" key={key}>
                <span className="prop-label">{f.label}</span>
                <ChipSelect
                  field={f}
                  value={meta[key]}
                  stop={false}
                  onPick={(v) => setMeta((m) => ({ ...m, [key]: v }))}
                />
              </div>
            )
          })}
        </div>
        {error && <div className="connect-error">{error}</div>}
        <div className="capture-actions">
          <button type="button" className="btn btn-ghost" onClick={closeNewScript}>
            Cancel
          </button>
          <button
            className="btn btn-gold"
            disabled={!title.trim() || busy}
            data-testid="capture-create"
          >
            {busy ? 'Capturing…' : 'Capture to vault'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
