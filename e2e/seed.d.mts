export interface SeedNote {
  id: string
  path: string
  extension: string
  content: string
  tags: string[]
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export declare function makeSeed(): SeedNote[]
export declare const TAGS: { name: string; count: number }[]
