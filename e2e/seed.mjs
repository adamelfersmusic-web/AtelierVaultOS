// Seed data for the mock vault — shaped exactly like the live Parachute
// vault's scripts dataset (paths, tags, metadata vocabulary).

let seq = 100
const noteId = () => `2026-06-02-03-51-15-${seq++}`

function script(slug, meta, body, extraTags = []) {
  const title = slug
    .split('-')
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ')
  const content =
    body ??
    `# ${title}\n*JONATHAN GAIETTO — REVISED SCRIPT*\n*Real life. Real work. Real family. No hype.*\n\n**Pillar:** ${meta.pillar ?? '—'}\n**Status:** Stale Header — ignore me\n\n---\n\nMade two sales by noon one day last week.\n\nClosed the laptop.\nThat was it for the day.\n\nSome days still don't work.\nThat's true too.\n\nBut some days it's two by noon.\nAnd two hours in the woods with my kids.\n`
  return {
    id: noteId(),
    path: `content/scripts/${slug}`,
    extension: 'md',
    content,
    tags: ['content/script', 'type/content', ...extraTags],
    metadata: {
      recorded: 'no',
      published: 'no',
      approval_required: false,
      declined: false,
      voice: 'operator',
      cta_level: '0',
      ...meta,
    },
    createdAt: '2026-06-02T03:51:15.000Z',
    updatedAt: `2026-06-0${(seq % 8) + 1}T0${seq % 9}:30:00.000Z`,
  }
}

function note(path, tags, meta, content) {
  return {
    id: noteId(),
    path,
    extension: 'md',
    content,
    tags,
    metadata: meta,
    createdAt: '2026-06-01T15:11:05.000Z',
    updatedAt: '2026-06-08T10:00:00.000Z',
  }
}

export function makeSeed() {
  seq = 100
  return [
    script('the-fake-map', { status: 'draft', pillar: 'presence', cta_level: '0' }),
    script('bedtime-tuck-in', { status: 'filmed', pillar: 'presence/integrity', cta_level: '1', approval_required: true }),
    script('conference-room', { status: 'draft', pillar: 'presence/income', cta_level: '3', approval_required: true }),
    script('provider-ad-v1', { status: 'approved', pillar: 'presence/income', cta_level: '3', conviction: 'killer', source: 'california' }),
    script('the-debit-card', { status: 'edited', pillar: 'presence/ownership', conviction: 'strong', source: 'california' }),
    script('the-bar-floor', { status: 'edited', pillar: 'integrity/ownership', approval_required: true, source: 'interview' }),
    script('the-bathtub-sales-call', { status: 'filmed', pillar: 'presence/income', cta_level: '1', conviction: 'killer', source: 'california' }),
    script('you-only-need-one', { status: 'edited', pillar: 'integrity/presence', conviction: 'strong', source: 'gpt' }),
    script('just-because-i-live-in-the-woods', { status: 'draft', pillar: 'protection/integrity', source: 'va' }),
    script('life-insurance-taught-me-about-being-a-dad', { status: 'published', pillar: 'integrity/presence', recorded: 'yes', published: 'yes', conviction: 'killer', source: 'california' }),
    script('your-kid-stopped-asking', { status: 'approved', pillar: 'presence', conviction: 'strong', source: 'email' }),
    script('the-provider-truth', { status: 'idea', pillar: 'presence', source: 'interview', verification: 'ANALYSIS-VERIFIED' }),
    script('three-hundred-short-on-rent', { status: 'idea', pillar: 'income', source: 'brainstorm', conviction: 'maybe' }),
    script('the-empty-chair', { status: 'idea', pillar: 'presence', source: 'founder-voice', conviction: 'strong' }),
    script('quota-vs-bedtime', { status: 'draft', pillar: 'presence/income', source: 'gpt', declined: true }),
    script('what-the-w2-never-told-you', { status: 'approved', pillar: 'ownership', cta_level: '2', conviction: 'strong', source: 'gpt' }),
    script(
      'founder-raw-rant-on-freedom',
      { status: 'idea', pillar: 'ownership', voice: 'founder', source: 'founder-voice' },
      `# Founder Raw Rant On Freedom\n\nVerbatim voice note — raw layer.\n\nI didn't build this to be busy. I built it to be free.\n`,
      ['do-not-alter'],
    ),
    note(
      'transcripts/california-day-one',
      ['transcript', 'interview'],
      { voice: 'founder', verification: 'VERIFIED', approval_required: true },
      `# California Day One\n\n**Summary at top, raw below — never edited.**\n\n---\n\n[00:00] We start rolling in the truck...\n[02:14] "The map was fake. The afternoon was real."\n`,
    ),
    note(
      'brand/05-content-pillars',
      ['brand-brain'],
      { voice: 'canon', verification: 'VERIFIED-CANON' },
      `# 05 — Content Pillars\n\nIncome · Ownership · Presence · Integrity · Protection.\n`,
    ),
    note(
      'intel/the-analytics-gap',
      ['intel', 'domain/analytics', 'todo'],
      { verification: 'ANALYSIS-VERIFIED', voice: 'operator' },
      `# The Analytics Gap\n\nThe data exists; we just don't own or capture it yet.\n`,
    ),
    note(
      'people/lead/sample-lead',
      ['people/lead', 'domain/recruiting'],
      { status: 'active' },
      `# Sample Lead\n\nMet through the woods video. Wants the discovery call.\n`,
    ),
    // A malformed note exactly as the live vault can return it: NO metadata
    // object and NO tags at all. This is the shape that crashed the graph
    // ("Cannot read properties of undefined (reading 'verification')").
    // Kept in the seed as a permanent regression guard for buildGraph.
    {
      id: noteId(),
      path: 'logs/raw-orphan-no-metadata',
      extension: 'md',
      content: `# Raw Orphan\n\nNo metadata, no tags — should render as faint, not crash.\n`,
      createdAt: '2026-06-01T15:11:05.000Z',
      updatedAt: '2026-06-08T10:00:00.000Z',
    },
  ]
}

// Link edges between seed notes (by path; the mock resolves ids at serve
// time). Shaped like the real vault: a transcript hub feeding scripts
// (provenance family → gold), one supersedes (red), wikilinks/related as the
// neutral mass, and several orphans left to drift at the rim.
export const LINK_DEFS = [
  { s: 'content/scripts/the-fake-map', t: 'transcripts/california-day-one', rel: 'sourced-from' },
  { s: 'content/scripts/bedtime-tuck-in', t: 'transcripts/california-day-one', rel: 'sourced-from' },
  { s: 'content/scripts/the-bathtub-sales-call', t: 'transcripts/california-day-one', rel: 'derived_from' },
  { s: 'content/scripts/the-debit-card', t: 'transcripts/california-day-one', rel: 'sourced-from' },
  { s: 'content/scripts/the-bar-floor', t: 'transcripts/california-day-one', rel: 'source_of' },
  { s: 'content/scripts/the-provider-truth', t: 'transcripts/california-day-one', rel: 'derived_from' },
  { s: 'content/scripts/you-only-need-one', t: 'transcripts/california-day-one', rel: 'sourced-from' },
  { s: 'content/scripts/life-insurance-taught-me-about-being-a-dad', t: 'transcripts/california-day-one', rel: 'sourced-from' },
  { s: 'brand/05-content-pillars', t: 'content/scripts/the-fake-map', rel: 'informs' },
  { s: 'brand/05-content-pillars', t: 'content/scripts/the-empty-chair', rel: 'informs' },
  { s: 'brand/05-content-pillars', t: 'content/scripts/your-kid-stopped-asking', rel: 'informs' },
  { s: 'content/scripts/the-empty-chair', t: 'content/scripts/founder-raw-rant-on-freedom', rel: 'derived-from' },
  { s: 'content/scripts/what-the-w2-never-told-you', t: 'content/scripts/quota-vs-bedtime', rel: 'supersedes' },
  { s: 'intel/the-analytics-gap', t: 'people/lead/sample-lead', rel: 'mentions' },
  { s: 'intel/the-analytics-gap', t: 'content/scripts/provider-ad-v1', rel: 'references' },
  { s: 'content/scripts/provider-ad-v1', t: 'content/scripts/conference-room', rel: 'related' },
  { s: 'content/scripts/three-hundred-short-on-rent', t: 'content/scripts/the-fake-map', rel: 'wikilink' },
  { s: 'content/scripts/just-because-i-live-in-the-woods', t: 'content/scripts/the-fake-map', rel: 'wikilink' },
]

export const TAGS = [
  { name: 'content/script', count: 17 },
  { name: 'type/content', count: 17 },
  { name: 'content/idea', count: 14 },
  { name: 'transcript', count: 2 },
  { name: 'do-not-alter', count: 1 },
  { name: 'brand-brain', count: 1 },
  { name: 'intel', count: 1 },
  { name: 'people/lead', count: 1 },
  { name: 'interview', count: 1 },
]
