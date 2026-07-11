// Vault-aware image node. Vault attachments are stored in note bodies as
// root-relative paths (`/api/storage/<date>/<file>`); a plain <img src> resolves
// those against the APP origin, not the vault, so they 404 and show broken. This
// extends the base Image node with a view that resolves such paths against the
// vault — fetching WITH the bearer token (an <img> can't send one) and showing a
// blob URL, with a plain absolute-URL fallback if the authed fetch fails (public
// storage). The node's `src` attribute is never mutated, so markdown round-trips
// the original relative path unchanged.

import Image from '@tiptap/extension-image'
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/core'
import { useEffect, useState } from 'react'
import { fetchVaultAsset, vaultAssetUrl } from '../../lib/store'

/** Root-relative vault path (needs resolving). http(s)/data/blob srcs are fine
 *  as-is. */
function needsResolving(src: string): boolean {
  return src.startsWith('/')
}

function VaultImageView({ node }: NodeViewProps) {
  const src = (node.attrs.src as string) || ''
  const alt = (node.attrs.alt as string) || ''
  const title = (node.attrs.title as string) || ''
  const [resolved, setResolved] = useState<string | null>(
    src && !needsResolving(src) ? src : null,
  )
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!src || !needsResolving(src)) {
      setResolved(src || null)
      setFailed(!src)
      return
    }
    let objectUrl: string | null = null
    let cancelled = false
    setResolved(null)
    setFailed(false)
    fetchVaultAsset(src)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url)
          return
        }
        objectUrl = url
        setResolved(url)
      })
      .catch(() => {
        if (cancelled) return
        // Authed fetch failed — fall back to the plain absolute URL (works if
        // storage is public / doesn't require the token).
        try {
          setResolved(vaultAssetUrl(src))
        } catch {
          setFailed(true)
        }
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  return (
    <NodeViewWrapper className="vault-image-wrap" contentEditable={false}>
      {resolved && !failed ? (
        <img
          src={resolved}
          alt={alt}
          title={title || alt}
          className="vault-image"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="vault-image-fallback" title={src}>
          {failed ? `\u{1F5BC} ${alt || 'image unavailable'}` : '\u{1F5BC} …'}
        </span>
      )}
    </NodeViewWrapper>
  )
}

export const VaultImage = Image.extend({
  addNodeView() {
    return ReactNodeViewRenderer(VaultImageView)
  },
})
