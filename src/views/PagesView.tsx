// Pages — a full-bleed, two-pane writing space (the Shell collapses away, like
// Graph). Left: every page, newest-first, with a "New page" button and the
// settings gear. Right: the block editor for the open page, or an invitation
// to start one.

import { useEffect, useState } from 'react'
import {
  createPage,
  loadPages,
  toast,
  useStore,
} from '../lib/store'
import { hrefFor, navigate } from '../lib/router'
import { relativeTime, titleFromPath } from '../lib/format'
import {
  PAGES_SETTINGS_EVENT,
  setSetting,
  useEditorSettings,
} from '../lib/editorSettings'
import { listScribeModels } from '../lib/scribe'
import { Modal } from '../components/Modal'
import { IconPlus, IconSettings } from '../components/Icons'
import { PageEditor } from './PageEditor'

export function PagesView({ path }: { path?: string }) {
  const { pages, pagesStatus, pagesError, notes } = useStore()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  // Lazy-load the dataset when the view first opens.
  useEffect(() => {
    void loadPages()
  }, [])

  // Let any corner of the app open settings (e.g. the /ai no-key prompt).
  useEffect(() => {
    const open = () => setSettingsOpen(true)
    window.addEventListener(PAGES_SETTINGS_EVENT, open)
    return () => window.removeEventListener(PAGES_SETTINGS_EVENT, open)
  }, [])

  const newPage = async () => {
    if (creating) return
    setCreating(true)
    try {
      const note = await createPage({ title: 'Untitled' })
      navigate({ kind: 'pages', path: note.path })
    } catch (e) {
      toast('error', `Couldn’t create page — ${e instanceof Error ? e.message : e}`)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="pages" data-testid="pages">
      <aside className="pages-sidebar">
        <div className="pages-sidebar-head">
          <a
            className="pages-wordmark"
            href="#/scripts"
            onClick={(e) => {
              e.preventDefault()
              navigate({ kind: 'scripts' })
            }}
            title="Back to Atelier"
          >
            <svg width="15" height="15" viewBox="0 0 32 32" aria-hidden="true">
              <path
                d="M16 4.5 27.5 16 16 27.5 4.5 16Z"
                fill="none"
                stroke="var(--gold)"
                strokeWidth="2.6"
              />
              <circle cx="16" cy="16" r="3" fill="var(--gold)" />
            </svg>
            Pages
          </a>
          <button
            className="icon-btn"
            title="Editor settings"
            aria-label="Editor settings"
            onClick={() => setSettingsOpen(true)}
          >
            <IconSettings size={15} />
          </button>
        </div>

        <button
          className="rail-new pages-new"
          onClick={() => void newPage()}
          disabled={creating}
        >
          <IconPlus size={14} />
          New page
        </button>

        <div className="pages-list">
          {pagesStatus === 'loading' && !pages ? (
            <div className="db-skeleton">
              <div className="skel-row" />
              <div className="skel-row" />
              <div className="skel-row" />
            </div>
          ) : pagesError && !pages ? (
            <div className="pages-side-state">
              <p>Couldn’t load pages.</p>
              <button className="btn btn-ghost" onClick={() => void loadPages()}>
                Retry
              </button>
            </div>
          ) : (pages ?? []).length === 0 ? (
            <p className="pages-side-empty">No pages yet.</p>
          ) : (
            (pages ?? []).map((p) => (
              <a
                key={p}
                className={`pages-item${p === path ? ' is-active' : ''}`}
                href={hrefFor({ kind: 'pages', path: p })}
              >
                <span className="pages-item-title">{titleFromPath(p)}</span>
                <span className="pages-item-time">
                  {relativeTime(notes[p]?.updatedAt)}
                </span>
              </a>
            ))
          )}
        </div>
      </aside>

      <main className="pages-main">
        {path ? (
          <PageEditor key={path} path={path} />
        ) : (
          <div className="page-empty">
            <p className="page-empty-title">A clean page</p>
            <p className="page-empty-msg">
              Pick a page from the left, or start a new one. Type{' '}
              <kbd>/</kbd> anywhere for blocks, <kbd>/ai</kbd> to ask your vault,{' '}
              <kbd>/voice</kbd> to dictate.
            </p>
            <button className="btn btn-gold" onClick={() => void newPage()} disabled={creating}>
              <IconPlus size={14} />
              New page
            </button>
          </div>
        )}
      </main>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

// ——— settings: client-only keys for /ai (Anthropic) and /voice (scribe) ———

function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useEditorSettings()
  const [models, setModels] = useState<string[] | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)

  const detect = async () => {
    if (loadingModels) return
    setLoadingModels(true)
    try {
      const list = await listScribeModels(s.scribeUrl, s.scribeToken || undefined)
      setModels(list)
      if (list.length > 0 && !list.includes(s.scribeModel)) {
        setSetting('scribeModel', list[0]!)
      }
    } catch (e) {
      toast('error', `Couldn’t list models — ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoadingModels(false)
    }
  }

  return (
    <Modal onClose={onClose} width={480} labelledBy="settings-title">
      <div className="settings-panel">
        <h2 id="settings-title" className="settings-title">
          Editor settings
        </h2>
        <p className="settings-note">
          Stored only in this browser — never committed, never sent to the vault.
        </p>

        <div className="settings-group">
          <div className="settings-group-label">Ask AI · Anthropic</div>
          <label className="settings-field">
            <span className="settings-field-label">API key</span>
            <input
              type="password"
              className="settings-input"
              placeholder="sk-ant-…"
              autoComplete="off"
              value={s.anthropicKey}
              onChange={(e) => setSetting('anthropicKey', e.target.value)}
            />
          </label>
        </div>

        <div className="settings-group">
          <div className="settings-group-label">Voice · parachute-scribe</div>
          <label className="settings-field">
            <span className="settings-field-label">Scribe URL</span>
            <input
              className="settings-input"
              placeholder="http://localhost:1943"
              value={s.scribeUrl}
              onChange={(e) => setSetting('scribeUrl', e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">
              Token <em>optional</em>
            </span>
            <input
              type="password"
              className="settings-input"
              autoComplete="off"
              value={s.scribeToken}
              onChange={(e) => setSetting('scribeToken', e.target.value)}
            />
          </label>
          <label className="settings-field">
            <span className="settings-field-label">Model</span>
            <span className="settings-model">
              <input
                className="settings-input"
                value={s.scribeModel}
                onChange={(e) => setSetting('scribeModel', e.target.value)}
              />
              <button
                className="btn btn-ghost"
                disabled={loadingModels}
                onClick={() => void detect()}
              >
                {loadingModels ? '…' : 'Detect'}
              </button>
            </span>
          </label>
          {models && models.length > 0 && (
            <div className="settings-models">
              {models.map((m) => (
                <button
                  key={m}
                  className={`settings-chip${m === s.scribeModel ? ' is-on' : ''}`}
                  onClick={() => setSetting('scribeModel', m)}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
          <label className="settings-check">
            <input
              type="checkbox"
              checked={s.scribeCleanup}
              onChange={(e) => setSetting('scribeCleanup', e.target.checked)}
            />
            <span>Clean up transcript</span>
          </label>
        </div>

        <div className="settings-actions">
          <button className="btn btn-gold" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Modal>
  )
}
