// Minimal hash router. Hash routes keep raw slashes in note paths
// (#/note/content/scripts/the-fake-map) so vault locations read naturally.

import { useSyncExternalStore } from 'react'
import type { LensKind } from './types'

export type Route =
  | { kind: 'connect' }
  | { kind: 'scripts'; lens?: LensKind }
  | { kind: 'note'; path: string }
  | { kind: 'library' }
  | { kind: 'graph' }
  | { kind: 'pages'; path?: string }

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '')
  const [head, ...rest] = h.split('/')
  switch (head) {
    case 'connect':
      return { kind: 'connect' }
    case 'note': {
      const path = rest.map(decodeURIComponent).join('/')
      return path ? { kind: 'note', path } : { kind: 'scripts' }
    }
    case 'library':
      return { kind: 'library' }
    case 'graph':
      return { kind: 'graph' }
    case 'pages': {
      // Reuse the note case's per-segment decode, keeping raw slashes so the
      // page's full vault path (pages/<slug>) reads naturally in the hash.
      const path = rest.map(decodeURIComponent).join('/')
      return path ? { kind: 'pages', path } : { kind: 'pages' }
    }
    case 'scripts': {
      const lens = rest[0]
      if (lens === 'table' || lens === 'board' || lens === 'gallery') {
        return { kind: 'scripts', lens }
      }
      return { kind: 'scripts' }
    }
    default:
      return { kind: 'scripts' }
  }
}

export function hrefFor(route: Route): string {
  switch (route.kind) {
    case 'connect':
      return '#/connect'
    case 'scripts':
      return route.lens ? `#/scripts/${route.lens}` : '#/scripts'
    case 'library':
      return '#/library'
    case 'graph':
      return '#/graph'
    case 'pages':
      return route.path
        ? `#/pages/${route.path.split('/').map(encodeURIComponent).join('/')}`
        : '#/pages'
    case 'note':
      return `#/note/${route.path.split('/').map(encodeURIComponent).join('/')}`
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route)
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

function getSnapshot(): string {
  return window.location.hash
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, getSnapshot)
  return parseHash(hash)
}

/** Guard asked before leaving the current route (dirty editors). */
let routeGuard: (() => boolean) | null = null
let lastHash = window.location.hash

export function setRouteGuard(guard: (() => boolean) | null): void {
  routeGuard = guard
  lastHash = window.location.hash
}

window.addEventListener('hashchange', () => {
  if (routeGuard && window.location.hash !== lastHash) {
    if (!routeGuard()) {
      // Veto: restore the previous hash without re-triggering the guard.
      const guard = routeGuard
      routeGuard = null
      window.location.hash = lastHash
      setTimeout(() => {
        routeGuard = guard
      }, 0)
      return
    }
    routeGuard = null
  }
  lastHash = window.location.hash
})
