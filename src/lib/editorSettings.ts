// Client-only editor settings, localStorage-backed. These keys are NEVER
// committed and NEVER sent to the vault — they are read at call time by the
// /ai (Anthropic) and /voice (parachute-scribe) blocks. A tiny external store
// so the settings panel and the blocks stay in lockstep the instant a value
// changes (mirrors lib/ui.ts).

import { useSyncExternalStore } from 'react'

export interface EditorSettings {
  /** Anthropic API key — required for the /ai block. */
  anthropicKey: string
  /** Scribe base URL — a separate service; default localhost, or a tailnet URL. */
  scribeUrl: string
  /** Optional scribe bearer token (SCRIBE_AUTH_TOKEN deployments). */
  scribeToken: string
  /** Scribe model; can be populated from GET <scribeUrl>/v1/models. */
  scribeModel: string
  /** Ask scribe to clean up the transcript. */
  scribeCleanup: boolean
}

const KEYS: Record<keyof EditorSettings, string> = {
  anthropicKey: 'atelier.anthropicKey',
  scribeUrl: 'atelier.scribeUrl',
  scribeToken: 'atelier.scribeToken',
  scribeModel: 'atelier.scribeModel',
  scribeCleanup: 'atelier.scribeCleanup',
}

const DEFAULTS: EditorSettings = {
  anthropicKey: '',
  scribeUrl: 'http://localhost:1943',
  scribeToken: '',
  scribeModel: 'parakeet-mlx',
  scribeCleanup: false,
}

function readString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

function read(): EditorSettings {
  return {
    anthropicKey: readString(KEYS.anthropicKey, DEFAULTS.anthropicKey),
    scribeUrl: readString(KEYS.scribeUrl, DEFAULTS.scribeUrl) || DEFAULTS.scribeUrl,
    scribeToken: readString(KEYS.scribeToken, DEFAULTS.scribeToken),
    scribeModel:
      readString(KEYS.scribeModel, DEFAULTS.scribeModel) || DEFAULTS.scribeModel,
    scribeCleanup: readString(KEYS.scribeCleanup, '') === 'true',
  }
}

// Cache a stable snapshot so useSyncExternalStore doesn't tear.
let snapshot = read()
const listeners = new Set<() => void>()

function emit(): void {
  snapshot = read()
  for (const l of listeners) l()
}

export function getSettings(): EditorSettings {
  return snapshot
}

export function setSetting<K extends keyof EditorSettings>(
  key: K,
  value: EditorSettings[K],
): void {
  const raw =
    typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value)
  try {
    if (raw === '') localStorage.removeItem(KEYS[key])
    else localStorage.setItem(KEYS[key], raw)
  } catch {
    /* private mode / quota — settings just don't persist */
  }
  emit()
}

export function useEditorSettings(): EditorSettings {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => snapshot,
  )
}

// ——— cross-component bridge: open the Pages settings panel from anywhere ———
export const PAGES_SETTINGS_EVENT = 'atelier:pages-settings'
export function openPagesSettings(): void {
  window.dispatchEvent(new Event(PAGES_SETTINGS_EVENT))
}
