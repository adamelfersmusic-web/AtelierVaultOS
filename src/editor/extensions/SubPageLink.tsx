// Sub-page link — an inline chip that mentions another page and navigates to
// it within the editor. It SERIALIZES as a plain markdown link to the page's
// vault path (`[Title](pages/<slug>)`) so Library search, Graph, and NotePage
// keep seeing an ordinary link. On load we convert `pages/` link-marks back
// into chips (see convertPageLinks) — the round-trip stays stable because the
// chip re-renders to the exact same markdown link.

import { Node, mergeAttributes } from '@tiptap/core'
import type { JSONContent } from '@tiptap/core'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { navigate, hrefFor } from '../../lib/router'
import { titleFromPath } from '../../lib/format'
import { IconPage } from '../../components/Icons'

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
          if (path) navigate({ kind: 'pages', path })
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
        href: hrefFor({ kind: 'pages', path }),
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
    return `[${titleFromPath(path)}](${path})`
  },
})

// ——— load-time conversion: `pages/` link-marks → subPageLink nodes ———

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
 * link mark with a subPageLink node. Returns the (possibly new) doc and a flag
 * so callers can skip a needless re-set when nothing changed.
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
