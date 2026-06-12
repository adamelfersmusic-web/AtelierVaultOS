import { useEffect } from 'react'
import { useStore } from './lib/store'
import { useUi, openPalette, closePalette } from './lib/ui'
import { navigate, useRoute } from './lib/router'
import { Shell } from './views/Shell'
import { ConnectView } from './views/ConnectView'
import { DatabaseView } from './views/DatabaseView'
import { NotePage } from './views/NotePage'
import { LibraryView } from './views/LibraryView'
import { NewScriptModal } from './views/NewScriptModal'
import { CommandPalette } from './components/CommandPalette'
import { ToastHost } from './components/Toast'
import { SCRIPTS_DB } from './domain/scripts'

export default function App() {
  const { config } = useStore()
  const ui = useUi()
  const route = useRoute()

  // Global shortcuts: ⌘K / Ctrl+K opens the palette anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (ui.paletteOpen) closePalette()
        else if (config) openPalette()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ui.paletteOpen, config])

  // Route guard: unconfigured sessions land on connect; configured sessions
  // never see it.
  useEffect(() => {
    if (!config && route.kind !== 'connect') navigate({ kind: 'connect' })
    if (config && route.kind === 'connect') navigate({ kind: 'scripts' })
  }, [config, route.kind])

  if (!config || route.kind === 'connect') {
    return (
      <>
        <ConnectView />
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
