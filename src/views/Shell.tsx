import type { ReactNode } from 'react'
import { disconnect, useStore } from '../lib/store'
import { navigate, type Route } from '../lib/router'
import { openNewScript, openPalette } from '../lib/ui'
import {
  IconDisconnect,
  IconLibrary,
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
  const { config, connection } = useStore()
  const host = config ? new URL(config.url).host + new URL(config.url).pathname : ''

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
                token rejected
              </span>
            </div>
          ) : (
            <div className="vault-status">
              <i className="status-dot" />
              <span className="vault-host" title={host}>
                {host}
              </span>
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
