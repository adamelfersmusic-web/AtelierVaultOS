// Sub-page link — an inline chip that mentions another note and navigates to
// it. It SERIALIZES as a real Parachute wikilink (`[[vault/path]]`) so the vault
// records an actual graph EDGE (markdown `[title](path)` links are NOT indexed
// as edges by Parachute — only `[[...]]` wikilinks are). On load we convert both
// `[[...]]` wikilinks AND legacy `pages/` markdown link-marks back into chips, so
// old notes keep working and any real wikilink already in the vault renders as a
// chip too. Chips route to the Pages editor for `pages/` paths and to the read
// view (NotePage) for everything else.

import { Node, mergeAttributes } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { navigate, hrefFor } from '../../lib/router'
import { titleFromPath } from '../../lib/format'
import { IconPage } from '../../components/Icons'

/** A wikilink to `pages/...` opens in the block editor; anything else is an
 *  ordinary vault note and opens in the read view. */
function routeFor(path: string): Parameters<typeof navigate>[0] {
  return path.startsWith('pages/')
    ? { kind: 'pages', path }
    : { kind: 'note', path }
}

function SubPageLinkView({ node }: NodeViewProps) {
  const path = (node.attrs.path as string) || ''
  return (
    <NodeViewWrapper as="span" className="subpage-wrap">
      <button
        type="button"
        className="subpage-link"
        contentEditable={false}
        // Don't let the click steal the editor selection before we navigate.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (path) navigate(routeFor(path))
        }}
        title={path}
      >
        <IconPage size={13} />
        <span className="subpage-title">
          {titleFromPath(path) || 'Untitled page'}
        </span>
      </button>
    </NodeViewWrapper>
  )
}

export const SubPageLink = Node.create({
  name: 'subPageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      path: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-path') ?? '',
        renderHTML: (attrs) => ({ 'data-path': attrs.path }),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'a[data-subpage]' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    const path = (node.attrs.path as string) || ''
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-subpage': '',
        class: 'subpage-link',
        href: hrefFor(routeFor(path)),
      }),
      titleFromPath(path) || 'Untitled page',
    ]
  },

  addNodeView() {
    return ReactNodeViewRenderer(SubPageLinkView)
  },

  renderMarkdown: (node) => {
    const path = (node.attrs?.path as string) ?? ''
    if (!path) return ''
    // Real Parachute wikilink → the vault records a graph edge.
    return `[[${path}]]`
  },
})

// ——— load-time conversion ———

/** Matches an inline `[[vault/path]]` wikilink. Path may contain slashes,
 *  hyphens, spaces — anything but a closing bracket or newline. */
const WIKILINK = /\[\[([^\]\n]+)\]\]/g

const PAGE_HREF = /^(?:#\/pages\/|pages\/)/

/** Normalize a link href to the vault path form `pages/<...>`, or null. */
export function pagePathFromHref(href: string): string | null {
  if (!PAGE_HREF.test(href)) return null
  const rest = href.replace(/^#\//, '') // '#/pages/...' → 'pages/...'
  return rest
    .split('/')
    .map((s) => {
      try {
        return decodeURIComponent(s)
      } catch {
        return s
      }
    })
    .join('/')
}

/**
 * Walk a ProseMirror JSON doc and replace any text node carrying a `pages/`
 * link mark with a subPageLink node (legacy format — notes written before the
 * wikilink migration). Returns the (possibly new) doc and a changed flag.
 */
export function convertPageLinks(doc: JSONContent): {
  doc: JSONContent
  changed: boolean
} {
  let changed = false
  const walk = (node: JSONContent): JSONContent => {
    if (!Array.isArray(node.content)) return node
    const next: JSONContent[] = []
    for (const child of node.content) {
      if (child.type === 'text' && Array.isArray(child.marks)) {
        const link = child.marks.find((m) => m.type === 'link')
        const href = link?.attrs?.href as string | undefined
        const path = href ? pagePathFromHref(href) : null
        if (path) {
          next.push({ type: 'subPageLink', attrs: { path } })
          changed = true
          continue
        }
      }
      next.push(walk(child))
    }
    return { ...node, content: next }
  }
  return { doc: walk(doc), changed }
}

/**
 * Walk a ProseMirror JSON doc and replace inline `[[vault/path]]` wikilinks
 * (which the markdown parser leaves as literal text) with subPageLink chips.
 * A text node may hold several wikilinks with prose between them, so each is
 * split into [text?, chip, text?, chip, …] preserving the original marks.
 */
export function convertWikiLinks(doc: JSONContent): {
  doc: JSONContent
  changed: boolean
} {
  let changed = false

  const expandText = (child: JSONContent): JSONContent[] => {
    const text = child.text
    if (typeof text !== 'string' || text.indexOf('[[') === -1) return [child]
    const out: JSONContent[] = []
    let last = 0
    let found = false
    WIKILINK.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = WIKILINK.exec(text)) !== null) {
      found = true
      if (m.index > last) out.push({ ...child, text: text.slice(last, m.index) })
      out.push({ type: 'subPageLink', attrs: { path: m[1]!.trim() } })
      last = m.index + m[0].length
    }
    if (!found) return [child]
    if (last < text.length) out.push({ ...child, text: text.slice(last) })
    changed = true
    return out
  }

  const walk = (node: JSONContent): JSONContent => {
    if (!Array.isArray(node.content)) return node
    const next: JSONContent[] = []
    for (const child of node.content) {
      if (child.type === 'text') next.push(...expandText(child))
      else next.push(walk(child))
    }
    return { ...node, content: next }
  }

  return { doc: walk(doc), changed }
}
