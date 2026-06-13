// The Pages dataset — freeform block-editor notes under `pages/`, tagged
// `type/page`. Mirrors domain/scripts.ts, but pages are a writing surface, not
// a typed database: no fields, no lenses.
//
// Path convention is FLAT (`pages/<slug>`). Hierarchy is modeled through
// sub-page LINKS, never nested paths — so a page can live in many "places" at
// once and Library/Graph/NotePage keep seeing one clean prefix.

import type { NoteMetadata } from '../lib/types'

export const PAGES_PREFIX = 'pages/'
export const PAGE_TAG = 'type/page'

/** Tags + metadata + path prefix stamped onto notes created as pages. */
export const NEW_PAGE: {
  pathPrefix: string
  tags: string[]
  metadata: NoteMetadata
} = {
  pathPrefix: PAGES_PREFIX,
  tags: [PAGE_TAG],
  metadata: {},
}

/** Body seed for a brand-new page: just an H1 of the title. */
export function newPageContent(title: string): string {
  return `# ${title.trim()}\n`
}
