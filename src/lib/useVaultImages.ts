import { useEffect } from 'react'
import type { RefObject } from 'react'
import { fetchVaultAsset, vaultAssetUrl } from './store'

/**
 * After a markdown body renders, resolve the `data-vault-src` image
 * placeholders staged by renderMarkdown (vault `/api/storage/...` attachments)
 * into real, displayable URLs. Fetches WITH the bearer token and shows a blob
 * URL when storage is auth-gated, falling back to a plain absolute URL when it
 * is public. Object URLs are revoked on cleanup.
 *
 * Pass the rendered container ref and a dependency (usually the note content)
 * so it re-runs when the body changes.
 */
export function useVaultImages(
  ref: RefObject<HTMLElement | null>,
  dep: unknown,
): void {
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const imgs = Array.from(
      el.querySelectorAll<HTMLImageElement>('img[data-vault-src]'),
    )
    if (imgs.length === 0) return

    let cancelled = false
    const created: string[] = []

    for (const img of imgs) {
      const path = img.getAttribute('data-vault-src')
      if (!path) continue
      fetchVaultAsset(path)
        .then((url) => {
          if (cancelled) {
            URL.revokeObjectURL(url)
            return
          }
          created.push(url)
          img.src = url
        })
        .catch(() => {
          if (cancelled) return
          try {
            img.src = vaultAssetUrl(path)
          } catch {
            /* not connected — leave the placeholder */
          }
        })
    }

    return () => {
      cancelled = true
      created.forEach((u) => URL.revokeObjectURL(u))
    }
  }, [ref, dep])
}
