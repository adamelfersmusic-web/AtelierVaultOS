/** "content/scripts/the-fake-map" → "the-fake-map" */
export function basename(path: string): string {
  const i = path.lastIndexOf('/')
  return i >= 0 ? path.slice(i + 1) : path
}

const SMALL_WORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'of',
  'on', 'or', 'the', 'to', 'vs', 'via',
])

/** De-slug a path basename into a display title: "the-fake-map" → "The Fake Map". */
export function titleFromPath(path: string): string {
  const words = basename(path).split(/[-_]+/).filter(Boolean)
  return words
    .map((w, i) => {
      const lower = w.toLowerCase()
      if (i > 0 && i < words.length - 1 && SMALL_WORDS.has(lower)) return lower
      return lower.charAt(0).toUpperCase() + lower.slice(1)
    })
    .join(' ')
}

/** "My Great Hook!" → "my-great-hook" */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function relativeTime(iso: string | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return '—'
  const s = Math.round((Date.now() - then) / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  const w = Math.round(d / 7)
  if (w < 5) return `${w}w ago`
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function fullTime(iso: string | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Strip the markdown heading + emphasis clutter from a lean `preview` snippet. */
export function cleanPreview(preview: string | undefined, title: string): string {
  if (!preview) return ''
  let p = preview.replace(/^#+\s*/, '')
  if (p.toLowerCase().startsWith(title.toLowerCase())) p = p.slice(title.length)
  return p.replace(/[*_#`>]+/g, ' ').replace(/\s+/g, ' ').trim()
}
