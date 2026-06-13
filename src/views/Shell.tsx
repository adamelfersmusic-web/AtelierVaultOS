import type { ReactNode } from 'react'
import { disconnect, useStore } from '../lib/store'
import { navigate, type Route } from '../lib/router'
import { openNewScript, openPalette } from '../lib/ui'
import {
  IconDisconnect,
  IconGraph,
  IconLibrary,
  IconPage,
  IconPlus,
  IconScripts,
} from '../components/Icons'

function Wordmark() {
  return (
    <a
      className="wordmark"
      href="#/scripts"
      onClick={(e) => {
        e.preventDefault()
        navigate({ kind: 'scripts' })
      }}
    >
      <svg className="wordmark-gem" width="18" height="18" viewBox="0 0 32 32" aria-hidden="true">
        <path
          d="M16 4.5 27.5 16 16 27.5 4.5 16Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
        />
        <circle cx="16" cy="16" r="3" fill="currentColor" />
      </svg>
      <span className="wordmark-text">
        Atelier
        <span className="wordmark-sub">Vault OS</span>
      </span>
    </a>
  )
}

export function Shell({ route, children }: { route: Route; children: ReactNode }) {
  const { session, connection } = useStore()
  let host = ''
  try {
    if (session) {
      const u = new URL(session.vaultUrl)
      host = u.host + u.pathname
    }
  } catch {
    host = session?.vaultUrl ?? ''
  }

  return (
    <div className="shell">
      <aside className="rail">
        <Wordmark />

        <button className="rail-new" onClick={openNewScript}>
          <IconPlus size={14} />
          New script
        </button>

        <nav className="rail-nav">
          <a
            className={`rail-link${route.kind === 'scripts' || route.kind === 'note' ? ' is-active' : ''}`}
            href="#/scripts"
          >
            <IconScripts size={15} />
            Scripts
          </a>
          <a
            className={`rail-link${route.kind === 'pages' ? ' is-active' : ''}`}
            href="#/pages"
          >
            <IconPage size={15} />
            Pages
          </a>
          <a
            className={`rail-link${route.kind === 'graph' ? ' is-active' : ''}`}
            href="#/graph"
          >
            <IconGraph size={15} />
            Graph
          </a>
          <a
            className={`rail-link${route.kind === 'library' ? ' is-active' : ''}`}
            href="#/library"
          >
            <IconLibrary size={15} />
            Library
          </a>
        </nav>

        <button className="rail-kbd" onClick={openPalette}>
          Jump anywhere
          <kbd>⌘K</kbd>
        </button>

        <div className="rail-foot">
          {connection === 'auth-error' ? (
            <div className="vault-status vault-status-error">
              <i className="status-dot status-dot-error" />
              <span className="vault-host" title={host}>
                session expired — reconnect
              </span>
            </div>
          ) : (
            <div
              className="vault-status"
              title={`${host} · ${session?.mode === 'oauth' ? 'OAuth session' : 'pasted token'}`}
            >
              <i className="status-dot" />
              <span className="vault-host">{host}</span>
            </div>
          )}
          <button
            className="rail-disconnect"
            title="Disconnect — clears the stored URL and token"
            onClick={() => {
              disconnect()
              navigate({ kind: 'connect' })
            }}
          >
            <IconDisconnect size={13} />
            Disconnect
          </button>
        </div>
      </aside>

      <main className="stage">{children}</main>
    </div>
  )
}
