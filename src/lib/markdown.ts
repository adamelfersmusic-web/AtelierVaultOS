import { marked } from 'marked'
import DOMPurify from 'dompurify'

// breaks:true — script bodies use single newlines as spoken-word line breaks;
// collapsing them would destroy the rhythm of the writing.
marked.setOptions({ gfm: true, breaks: true, async: false })

export function renderMarkdown(src: string): string {
  const html = marked.parse(src) as string
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style'],
    ADD_ATTR: ['target'],
  })
}
