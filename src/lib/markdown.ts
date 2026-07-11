import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { titleFromPath } from './format'

// breaks:true — script bodies use single newlines as spoken-word line breaks;
// collapsing them would destroy the rhythm of the writing.
marked.setOptions({ gfm: true, breaks: true, async: false })

// Turn Parachute `[[vault/path]]` wikilinks into real links before markdown
// parsing, so read views (NotePage, Library previews) show a clickable title
// instead of raw brackets. `pages/` paths route to the block editor, the rest
// to the note read view — matching the router. Links inside code spans/fences
// are the rare exception where this over-fires; acceptable for prose notes.
function linkifyWikilinks(src: string): string {
  return src.replace(/\[\[([^\]\n]+)\]\]/g, (_m, raw: string) => {
    const path = raw.trim()
    const enc = path.split('/').map(encodeURIComponent).join('/')
    const href = path.startsWith('pages/') ? `#/pages/${enc}` : `#/note/${enc}`
    return `[${titleFromPath(path)}](${href})`
  })
}

// Root-relative vault images (`/api/storage/...`) can't display from an <img>
// src — the browser resolves them against the app origin, not the vault, so
// they 404. Stage them as `data-vault-src` placeholders (no src → no broken
// flash); useVaultImages swaps in an auth-resolved URL after render. External
// http(s)/data images are left untouched.
function stageVaultImages(src: string): string {
  return src.replace(
    /!\[([^\]]*)\]\((\/[^)\s]+)\)/g,
    (_m, alt: string, path: string) =>
      `<img alt="${alt.replace(/"/g, '&quot;')}" data-vault-src="${path}" class="vault-img" />`,
  )
}

export function renderMarkdown(src: string): string {
  const html = marked.parse(stageVaultImages(linkifyWikilinks(src))) as string
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    ADD_ATTR: ['target', 'data-vault-src'],
  })
}
