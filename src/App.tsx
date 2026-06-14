import { lazy, Suspense, useEffect, useRef } from 'react'
import { processOAuthReturn, useStore } from './lib/store'
import { useUi, openPalette, closePalette } from './lib/ui'
import { navigate, useRoute } from './lib/router'
import { Shell } from './views/Shell'
import { ConnectView } from './views/ConnectView'
import { DatabaseView } from './views/DatabaseView'
import { NotePage } from './views/NotePage'
import { LibraryView } from './views/LibraryView'
import { GraphView } from './views/GraphView'
import { NewScriptModal } from './views/NewScriptModal'
import { CommandPalette } from './components/CommandPalette'
import { ToastHost } from './components/Toast'
import { SCRIPTS_DB } from './domain/scripts'

// Pages pulls in the whole Tiptap/ProseMirror editor — keep it out of the
// initial bundle so Scripts/Graph/Library stay light. It loads on first visit.
const PagesView = lazy(() =>
  import('./views/PagesView').then((m) => ({ default: m.PagesView })),
)

export default function App() {
  const { session, oauthStatus } = useStore()
  const ui = useUi()
  const route = useRoute()
  const ranReturn = useRef(false)

  // On first load, finish an OAuth return (?code&state / ?error) if present.
  // init() in main.tsx already restored any saved session synchronously.
  useEffect(() => {
    if (ranReturn.current) return
    ranReturn.current = true
    void processOAuthReturn()
  }, [])

  // Global shortcuts: ⌘K / Ctrl+K opens the palette anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (ui.paletteOpen) closePalette()
        else if (session) openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.paletteOpen, session])

  // Route guard: unconfigured sessions land on connect; configured sessions
  // never see it.
  useEffect(() => {
    if (!session && route.kind !== 'connect') navigate({ kind: 'connect' })
    if (session && route.kind === 'connect') navigate({ kind: 'scripts' })
  }, [session, route.kind])

  if (oauthStatus === 'completing') {
    return (
      <div className="connect">
        <div className="connect-glow" aria-hidden="true" />
        <div className="connect-card connect-completing" data-testid="oauth-completing">
          <div className="spinner" aria-hidden="true" />
          <h1 className="connect-title">Signing in…</h1>
          <p className="connect-sub">Exchanging the authorization code with your hub.</p>
        </div>
      </div>
    )
  }

  if (!session || route.kind === 'connect') {
    return (
      <>
        <ConnectView />
        <ToastHost />
      </>
    )
  }

  // The graph is full-bleed: the sidebar collapses away entirely.
  if (route.kind === 'graph') {
    return (
      <>
        <GraphView />
        {ui.paletteOpen && <CommandPalette />}
        <ToastHost />
      </>
    )
  }

  // Pages is full-bleed too — its own two-pane shell replaces the rail.
  if (route.kind === 'pages') {
    return (
      <>
        <Suspense
          fallback={
            <div className="pages-loading">
              <div className="spinner" aria-hidden="true" />
            </div>
          }
        >
          <PagesView path={route.path} />
        </Suspense>
        {ui.paletteOpen && <CommandPalette />}
        <ToastHost />
      </>
    )
  }

  return (
    <>
      <Shell route={route}>
        {route.kind === 'scripts' && (
          <DatabaseView def={SCRIPTS_DB} lensOverride={route.lens} />
        )}
        {route.kind === 'note' && <NotePage path={route.path} key={route.path} />}
        {route.kind === 'library' && <LibraryView />}
      </Shell>
      {ui.newScriptOpen && <NewScriptModal />}
      {ui.paletteOpen && <CommandPalette />}
      <ToastHost />
    </>
  )
}
