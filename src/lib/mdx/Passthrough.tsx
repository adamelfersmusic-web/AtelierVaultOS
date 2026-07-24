import type { ReactNode } from 'react'

// Graceful-degradation stub for MDX components we don't render yet
// (<Checklist>, <LayerQuiz>). MDX throws on a capitalized tag with no
// registered component, so an *unregistered* component would crash the very
// note we're testing. Registering this passthrough instead renders any
// children as plain text and drops attribute-only components to nothing —
// degrade, never crash.
export function Passthrough({ children }: { children?: ReactNode }) {
  return <>{children ?? null}</>
}
