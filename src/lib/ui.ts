// Tiny UI-state store for cross-cutting overlays (palette, capture modal).

import { useSyncExternalStore } from 'react'

interface UiState {
  paletteOpen: boolean
  newScriptOpen: boolean
}

let state: UiState = { paletteOpen: false, newScriptOpen: false }
const listeners = new Set<() => void>()

function set(partial: Partial<UiState>): void {
  state = { ...state, ...partial }
  for (const l of listeners) l()
}

export function useUi(): UiState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}

export const openPalette = () => set({ paletteOpen: true })
export const closePalette = () => set({ paletteOpen: false })
export const openNewScript = () => set({ newScriptOpen: true, paletteOpen: false })
export const closeNewScript = () => set({ newScriptOpen: false })
