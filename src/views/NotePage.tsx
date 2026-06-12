import { useEffect, useMemo, useRef, useState } from 'react'
import type { Note } from '../lib/types'
import {
  ContentDivergedError,
  fetchNote,
  forceContent,
  saveContent,
  setMetadata,
  toast,
  useStore,
} from '../lib/store'
import { setRouteGuard } from '../lib/router'
import { fullTime, relativeTime, titleFromPath } from '../lib/format'
import { renderMarkdown } from '../lib/markdown'
import {
  FIELDS,
  isProtectedNote,
  isScriptNote,
  protectionReason,
} from '../domain/scripts'
import { ChipSelect } from '../components/EnumMenu'
import { TagEditor } from '../components/TagEditor'
import { Modal } from '../components/Modal'
import { IconBack, IconEdit, IconShield } from '../components/Icons'
import { filterValueOf } from './DatabaseView'

type Status = 'loading' | 'ready' | 'missing' | 'error'

export function NotePage({ path }: { path: string }) {
  const { notes, scripts, saving } = useStore()
  const note = notes[path]
  const [status, setStatus] = useState<Status>(
    note?.content !== undefined ? 'ready' : 'loading',
  )
  const [loadError, setLoadError] = useState<string | null>(null)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const baseRef = useRef<{ content: string; updatedAt: string } | null>(null)
  const [conflict, setConflict] = useState<Note | null>(null)
  const [confirmCanon, setConfirmCanon] = useState(false)
  const [savingBody, setSavingBody] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const dirty = editing && draft !== (baseRef.current?.content ?? '')

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    fetchNote(path, { refresh: true })
      .then((n) => {
        if (cancelled) return
        setStatus(n ? 'ready' : 'missing')
      })
      .catch((e) => {
        if (cancelled) return
        // A cached copy is still browsable when the refresh fails.
        setStatus(note?.content !== undefined ? 'ready' : 'error')
        setLoadError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])

  // Leaving with unsaved work requires an explicit decision.
  useEffect(() => {
    if (!dirty) {
      setRouteGuard(null)
      return
    }
    setRouteGuard(() =>
      window.confirm('Discard unsaved changes to this note’s body?'),
    )
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      setRouteGuard(null)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [dirty])

  // Keep the editor sized to its content (including programmatic loads).
  useEffect(() => {
    if (editing && textRef.current) autosize(textRef.current)
  }, [editing, draft])

  const observed = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const f of FIELDS) map.set(f.key, new Set())
    for (const p of scripts ?? []) {
      const n = notes[p]
      if (!n) continue
      for (const f of FIELDS) {
        const v = filterValueOf(f, n)
        if (v) map.get(f.key)!.add(v)
      }
    }
    return map
  }, [scripts, notes])

  if (!note && status === 'loading') {
    return (
      <div className="note-page">
        <BackLink />
        <div className="db-skeleton">
          <div className="skel-row" />
          <div className="skel-row" />
        </div>
      </div>
    )
  }

  if (!note || status === 'missing') {
    return (
      <div className="note-page">
        <BackLink />
        <div className="db-state">
          <p className="db-state-title">Note not found</p>
          <p className="db-state-msg">
            <code>{path}</code> isn’t in the vault{loadError ? ` — ${loadError}` : '.'}
          </p>
        </div>
      </div>
    )
  }

  const isScript = isScriptNote(note)
  const protectedNote = isProtectedNote(note)
  const title = titleFromPath(note.path)
  const isSaving = (saving[path] ?? 0) > 0 || savingBody

  const startEdit = () => {
    const content = note.content ?? ''
    baseRef.current = { content, updatedAt: note.updatedAt }
    setDraft(content)
    setEditing(true)
    setTimeout(() => {
      const el = textRef.current
      if (el) {
        autosize(el)
        el.focus()
        el.setSelectionRange(0, 0)
      }
    }, 0)
  }

  const discard = () => {
    setEditing(false)
    setConflict(null)
    setConfirmCanon(false)
    baseRef.current = null
  }

  const doSave = async () => {
    const base = baseRef.current
    if (!base) return
    setSavingBody(true)
    try {
      await saveContent(path, draft, base)
      baseRef.current = null
      setEditing(false)
      setConflict(null)
      toast('success', 'Saved to vault')
    } catch (e) {
      if (e instanceof ContentDivergedError) {
        setConflict(e.fresh)
      } else {
        toast('error', `Couldn’t save — ${e instanceof Error ? e.message : e}`)
      }
    } finally {
      setSavingBody(false)
    }
  }

  const requestSave = () => {
    if (!dirty || savingBody) return
    if (protectedNote) {
      setConfirmCanon(true)
      return
    }
    void doSave()
  }

  const keepMine = async () => {
    if (!conflict) return
    setSavingBody(true)
    try {
      await forceContent(path, draft, conflict.updatedAt)
      baseRef.current = null
      setEditing(false)
      setConflict(null)
      toast('success', 'Saved — your version is now live')
    } catch (e) {
      // The note moved on again between conflict display and this click:
      // refresh the bar with the newest live version and let the human retry.
      toast('error', `Couldn’t save — ${e instanceof Error ? e.message : e}`)
      try {
        const freshest = await fetchNote(path, { refresh: true })
        if (freshest) setConflict(freshest)
      } catch {
        /* keep the stale conflict bar */
      }
    } finally {
      setSavingBody(false)
    }
  }

  const takeTheirs = () => {
    if (!conflict) return
    const theirs = conflict.content ?? ''
    baseRef.current = { content: theirs, updatedAt: conflict.updatedAt }
    setDraft(theirs)
    setConflict(null)
    toast('info', 'Loaded the live version into the editor')
  }

  return (
    <div className="note-page" data-testid="note-page">
      <div className="note-topbar">
        <BackLink />
        <span className="note-path" title={note.id}>
          {note.path}
        </span>
        {protectedNote && (
          <span className="canon-badge" title="Raw layer — never auto-written; edits need explicit confirmation">
            <IconShield size={12} />
            canon · {protectionReason(note)}
          </span>
        )}
        <span className="note-updated" title={fullTime(note.updatedAt)}>
          {isSaving ? 'saving…' : `edited ${relativeTime(note.updatedAt)}`}
        </span>
      </div>

      <h1 className="note-title">{title}</h1>

      {isScript ? (
        <div className="props" data-testid="props">
          {FIELDS.map((f) => {
            const value = note.metadata[f.key]
            return (
              <div className="prop" key={f.key}>
                <span className="prop-label">{f.label}</span>
                <ChipSelect
                  field={f}
                  value={f.kind === 'bool' ? value === true : value}
                  observed={observed.get(f.key)}
                  stop={false}
                  onPick={(v) =>
                    void setMetadata(path, { [f.key]: v }, { undo: { [f.key]: value ?? null } })
                  }
                />
              </div>
            )
          })}
        </div>
      ) : (
        Object.keys(note.metadata).length > 0 && (
          <div className="props props-readonly">
            {Object.entries(note.metadata).map(([k, v]) => (
              <div className="prop" key={k}>
                <span className="prop-label">{k}</span>
                <span className="prop-value">{formatMetaValue(v)}</span>
              </div>
            ))}
          </div>
        )
      )}

      <div className="note-tags">
        <TagEditor note={note} />
      </div>

      <hr className="note-rule" />

      {conflict && (
        <div className="conflict-bar" role="alert">
          <div className="conflict-text">
            <strong>This note changed in the vault while you were editing.</strong>
            <span>
              Live version from {fullTime(conflict.updatedAt)} — choose what
              survives.
            </span>
          </div>
          <div className="conflict-actions">
            <button className="btn btn-ghost" onClick={takeTheirs}>
              Load theirs
            </button>
            <button className="btn btn-danger" onClick={() => void keepMine()}>
              Overwrite with mine
            </button>
          </div>
        </div>
      )}

      {editing ? (
        <textarea
          ref={textRef}
          className="note-editor"
          data-testid="note-editor"
          value={draft}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
              e.preventDefault()
              requestSave()
            } else if (e.key === 'Escape' && !dirty) {
              discard()
            }
          }}
        />
      ) : (
        <div className="note-body-wrap">
          <button className="body-edit-btn" onClick={startEdit} data-testid="edit-body">
            <IconEdit size={13} />
            Edit
          </button>
          <article
            className="prose"
            data-testid="note-body"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(note.content ?? '') }}
          />
        </div>
      )}

      {editing && (
        <div className={`savebar${dirty ? ' is-dirty' : ''}`} data-testid="savebar">
          <span className="savebar-state">
            {savingBody ? 'Saving…' : dirty ? 'Unsaved changes' : 'No changes'}
          </span>
          <button className="btn btn-ghost" onClick={discard}>
            {dirty ? 'Discard' : 'Done'}
          </button>
          <button
            className="btn btn-gold"
            disabled={!dirty || savingBody}
            onClick={requestSave}
            data-testid="save-body"
          >
            Save <kbd>⌘S</kbd>
          </button>
        </div>
      )}

      {confirmCanon && (
        <Modal onClose={() => setConfirmCanon(false)} width={440} labelledBy="canon-title">
          <div className="canon-confirm">
            <IconShield size={22} className="canon-confirm-icon" />
            <h2 id="canon-title">This is founder canon</h2>
            <p>
              <code>{note.path}</code> is raw-layer material (
              {protectionReason(note)}). The vault’s law: raw is sacred. Saving
              will overwrite the original words.
            </p>
            <div className="canon-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmCanon(false)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                data-testid="canon-confirm"
                onClick={() => {
                  setConfirmCanon(false)
                  void doSave()
                }}
              >
                I’m sure — overwrite
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BackLink() {
  return (
    <a className="back-link" href="#/scripts">
      <IconBack size={13} />
      Scripts
    </a>
  )
}

function formatMetaValue(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function autosize(el: HTMLTextAreaElement): void {
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight + 2}px`
}
