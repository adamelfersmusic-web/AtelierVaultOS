/**
 * Tiny subsequence fuzzy matcher. Returns a score (higher = better) or null
 * when the query is not a subsequence of the target. Favors word-boundary
 * and consecutive hits.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 0
  let score = 0
  let ti = 0
  let lastHit = -2
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi]!
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found === -1) return null
    score += 1
    if (found === lastHit + 1) score += 2 // consecutive
    if (found === 0 || t[found - 1] === ' ' || t[found - 1] === '-' || t[found - 1] === '/') {
      score += 3 // word boundary
    }
    lastHit = found
    ti = found + 1
  }
  // Prefer shorter targets when scores tie.
  return score - t.length / 200
}
