// End-to-end drive of the whole product. By default it runs against the
// mock vault (which replicates the live Parachute REST contract, including
// optimistic concurrency): `npm run test:e2e` after `npm run build`.
//
// Set REAL_VAULT=<vault-url> REAL_TOKEN=<bearer> to run the SAME journeys
// against a genuine parachute-vault server (e.g. a local checkout booted
// with VAULT_AUTH_TOKEN) — the out-of-band writer + state assertions then
// go through the real REST API instead of the mock's control plane.

import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { makeSeed } from './seed.mjs'

const REAL = process.env.REAL_VAULT
const MOCK = 'http://127.0.0.1:8787'
const VAULT_URL = REAL || MOCK
const TOKEN = REAL ? (process.env.REAL_TOKEN ?? '') : 'atelier-test-token'
const SHOTS = 'e2e/.shots'
const AUTH = { Authorization: `Bearer ${TOKEN}` }

mkdirSync(SHOTS, { recursive: true })

async function resetVault(page: Page) {
  if (!REAL) {
    await page.request.post(`${MOCK}/__test/reset`)
    return
  }
  // Real server: wipe and re-seed through the genuine REST API.
  const list = await page.request.get(
    `${VAULT_URL}/api/notes?limit=1000`,
    { headers: AUTH },
  )
  for (const n of (await list.json()) as { id: string }[]) {
    await page.request.delete(
      `${VAULT_URL}/api/notes/${encodeURIComponent(n.id)}`,
      { headers: AUTH },
    )
  }
  const created = await page.request.post(`${VAULT_URL}/api/notes`, {
    headers: AUTH,
    data: {
      notes: makeSeed().map(({ path, content, tags, metadata, createdAt }) => ({
        path,
        content,
        tags,
        metadata,
        created_at: createdAt,
      })),
    },
  })
  expect(created.status(), await created.text()).toBe(201)
}

/** Read a note's live state out of the vault (bypassing the app). */
async function mockNote(page: Page, path: string) {
  const res = REAL
    ? await page.request.get(
        `${VAULT_URL}/api/notes?id=${encodeURIComponent(path)}&include_content=true`,
        { headers: AUTH },
      )
    : await page.request.get(
        `${MOCK}/__test/note?path=${encodeURIComponent(path)}`,
      )
  expect(res.ok()).toBeTruthy()
  return res.json()
}

/** Simulate an out-of-band writer (another agent) touching a note. */
async function bumpNote(
  page: Page,
  path: string,
  data: { content?: string; metadata?: Record<string, unknown> },
) {
  if (!REAL) {
    const res = await page.request.post(`${MOCK}/__test/bump`, {
      data: { path, ...data },
    })
    expect(res.ok()).toBeTruthy()
    return
  }
  const res = await page.request.patch(
    `${VAULT_URL}/api/notes/${encodeURIComponent(path)}`,
    { headers: AUTH, data: { ...data, force: true } },
  )
  expect(res.ok(), await res.text()).toBeTruthy()
}

/** Pre-authorize the app by seeding localStorage before any script runs. */
async function connectViaStorage(page: Page) {
  await page.addInitScript(
    ([url, token]) => {
      localStorage.setItem('atelier.vault', JSON.stringify({ url, token }))
    },
    [VAULT_URL, TOKEN] as const,
  )
}

async function openScripts(page: Page) {
  await connectViaStorage(page)
  await page.goto('/#/scripts/table')
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()
}

test.beforeEach(async ({ page }) => {
  await resetVault(page)
})

test('connect screen: token paste lives under Advanced and validates', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/#\/connect/)
  // OAuth is the primary path; token paste is the Advanced fallback.
  await expect(page.getByTestId('connect-oauth')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/01-connect.png` })

  await page.fill('input[name="vault-url"]', VAULT_URL)
  await page.getByTestId('advanced-toggle').click()
  await page.fill('textarea[name="vault-token"]', 'wrong-token')
  await page.getByTestId('connect-token').click()
  await expect(page.locator('.connect-error')).toBeVisible()

  await page.fill('textarea[name="vault-token"]', TOKEN)
  await page.getByTestId('connect-token').click()
  await expect(page).toHaveURL(/#\/scripts/)
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()
  // Session persisted for the next visit.
  const stored = await page.evaluate(() => localStorage.getItem('atelier.session.v1'))
  expect(JSON.parse(stored!)).toEqual({
    vaultUrl: VAULT_URL,
    mode: 'token',
    token: { accessToken: TOKEN },
  })
})

test('top bar: Brand Brain links out to the project in a new tab', async ({ page }) => {
  await openScripts(page)
  const link = page.getByRole('link', { name: 'Brand Brain' })
  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute(
    'href',
    'https://claude.ai/project/019df26a-e720-77a8-bfd1-1be88ba75aef',
  )
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /noreferrer/)
})

test('table: rows, sorting, pipeline filter, field filter, search', async ({ page }) => {
  await openScripts(page)
  const rows = page.locator('.db-table tbody tr')
  await expect(rows).toHaveCount(17)
  await page.screenshot({ path: `${SHOTS}/02-table.png`, fullPage: true })

  // Sort by status: ascending puts idea first (pipeline rank, not alpha).
  await page.click('.db-table th button:has-text("Status")')
  await expect(
    rows.first().locator('.chip-btn[data-field="status"] .chip'),
  ).toHaveText('idea')
  // Second click flips to descending → published first.
  await page.click('.db-table th button:has-text("Status")')
  await expect(
    rows.first().locator('.chip-btn[data-field="status"] .chip'),
  ).toHaveText('published')

  // Pillar (non-indexed) sorts in memory without erroring.
  await page.click('.db-table th button:has-text("Pillar")')
  await expect(rows.first()).toBeVisible()

  // Pipeline segment toggles a status filter.
  await page.click('.pipe-seg:has(.pipe-label:text-is("draft"))')
  await expect(page.locator('.filter-chip')).toContainText('Status')
  for (const chip of await rows
    .locator('.chip-btn[data-field="status"] .chip')
    .allTextContents()) {
    expect(chip).toBe('draft')
  }
  await page.click('.filter-chip .filter-chip-x')
  await expect(rows).toHaveCount(17)

  // Field filter via the Filter menu: conviction = killer.
  await page.click('button:has-text("Filter")')
  await page.click('.menu-item:has-text("Conviction")')
  await page.click('.popover .menu-item:has(.chip:text-is("killer"))')
  await page.keyboard.press('Escape')
  await expect(rows).toHaveCount(3)
  await page.click('.filter-clear')

  // Search narrows by title.
  await page.fill('.db-search', 'fake map')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('The Fake Map')
})

test('table cell edit writes metadata to the vault with if_updated_at', async ({ page }) => {
  await openScripts(page)
  const row = page.locator('.db-table tbody tr', { hasText: 'The Fake Map' })
  await row.locator('.chip-btn[data-field="status"]').click()
  await page.click('.popover .menu-item:has(.chip:text-is("approved"))')

  await expect(
    row.locator('.chip-btn[data-field="status"] .chip'),
  ).toHaveText('approved')
  await expect(page.locator('.toast')).toContainText('status → approved')

  const note = await mockNote(page, 'content/scripts/the-fake-map')
  expect(note.metadata.status).toBe('approved')
  // Body must be untouched by a metadata cell edit — including its stale
  // **Status:** header line.
  expect(note.content).toContain('**Status:** Stale Header — ignore me')

  // Undo from the toast restores the previous value in the vault.
  await page.click('.toast-action:has-text("Undo")')
  await expect(
    row.locator('.chip-btn[data-field="status"] .chip'),
  ).toHaveText('draft')
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/the-fake-map')).metadata.status)
    .toBe('draft')
})

test('cell edit survives a concurrent writer (409 → reload → reconcile → retry)', async ({ page }) => {
  await openScripts(page)
  // Another agent touches the note after our table loaded — our cached
  // updatedAt is now stale, so the first PATCH must 409 and reconcile.
  await bumpNote(page, 'content/scripts/the-fake-map', {
    metadata: { pillar: 'income' },
  })

  const row = page.locator('.db-table tbody tr', { hasText: 'The Fake Map' })
  await row.locator('.chip-btn[data-field="conviction"]').click()
  await page.click('.popover .menu-item:has(.chip:text-is("killer"))')
  await expect(
    row.locator('.chip-btn[data-field="conviction"] .chip'),
  ).toHaveText('killer')

  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/the-fake-map')).metadata.conviction)
    .toBe('killer')
  // The concurrent writer's change survived the reconcile.
  const note = await mockNote(page, 'content/scripts/the-fake-map')
  expect(note.metadata.pillar).toBe('income')
})

test('note page: properties, body read mode, body edit + save', async ({ page }) => {
  await openScripts(page)
  await page.click('.db-table tbody tr:has-text("The Fake Map") .cell-title')
  await expect(page.getByTestId('note-page')).toBeVisible()
  await expect(page.locator('.note-title')).toHaveText('The Fake Map')
  await expect(page.locator('.note-path')).toHaveText('content/scripts/the-fake-map')
  await expect(page.getByTestId('note-body')).toContainText('two sales by noon')
  await page.screenshot({ path: `${SHOTS}/03-note.png`, fullPage: true })

  // Property chip edit from the page header.
  await page.locator('.props .chip-btn[data-field="recorded"]').click()
  await page.click('.popover .menu-item:has(.chip:text-is("yes"))')
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/the-fake-map')).metadata.recorded)
    .toBe('yes')

  // Body edit.
  await page.getByTestId('edit-body').click()
  const editor = page.getByTestId('note-editor')
  await editor.click()
  await editor.press('Control+End')
  await editor.pressSequentially('\n\nNew closing line from Atelier.')
  await expect(page.getByTestId('savebar')).toContainText('Unsaved changes')
  await page.screenshot({ path: `${SHOTS}/04-editor.png`, fullPage: true })
  await editor.press('ControlOrMeta+s')
  await expect(page.locator('.toast').last()).toContainText('Saved to vault')
  await expect(page.getByTestId('note-body')).toContainText(
    'New closing line from Atelier.',
  )
  const note = await mockNote(page, 'content/scripts/the-fake-map')
  expect(note.content).toContain('New closing line from Atelier.')
  expect(note.metadata.recorded).toBe('yes')
})

test('body save auto-reconciles when only metadata moved elsewhere', async ({ page }) => {
  await connectViaStorage(page)
  await page.goto('/#/note/content/scripts/the-fake-map')
  await page.getByTestId('edit-body').click()
  const editor = page.getByTestId('note-editor')
  await editor.press('Control+End')
  await editor.pressSequentially('\nAppended while someone re-tagged.')

  // A concurrent writer changes metadata only — content untouched.
  await bumpNote(page, 'content/scripts/the-fake-map', {
    metadata: { conviction: 'strong' },
  })

  await page.getByTestId('save-body').click()
  await expect(page.locator('.toast').last()).toContainText('Saved to vault')
  const note = await mockNote(page, 'content/scripts/the-fake-map')
  expect(note.content).toContain('Appended while someone re-tagged.')
  expect(note.metadata.conviction).toBe('strong')
})

test('body conflict: diverged content needs a human decision', async ({ page }) => {
  await connectViaStorage(page)
  await page.goto('/#/note/content/scripts/the-fake-map')
  await page.getByTestId('edit-body').click()
  const editor = page.getByTestId('note-editor')
  await editor.press('Control+End')
  await editor.pressSequentially('\nMy edit.')

  // The content itself diverged in the vault.
  await bumpNote(page, 'content/scripts/the-fake-map', {
    content: '# The Fake Map\n\nRewritten elsewhere while you were editing.\n',
  })

  await page.getByTestId('save-body').click()
  await expect(page.locator('.conflict-bar')).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/05-conflict.png` })

  await page.click('.conflict-bar button:has-text("Overwrite with mine")')
  await expect(page.locator('.toast').last()).toContainText('your version is now live')
  const note = await mockNote(page, 'content/scripts/the-fake-map')
  expect(note.content).toContain('My edit.')
  expect(note.content).not.toContain('Rewritten elsewhere')
})

test('tags: add and remove are full-replace, via add/remove diff', async ({ page }) => {
  await connectViaStorage(page)
  await page.goto('/#/note/content/scripts/the-fake-map')
  await page.click('.tag-add')
  await page.fill('.tag-input', 'winter-batch')
  await page.press('.tag-input', 'Enter')
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/the-fake-map')).tags)
    .toContain('winter-batch')

  await page.click('button[aria-label="Remove tag winter-batch"]')
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/the-fake-map')).tags)
    .not.toContain('winter-batch')
})

test('canon notes are human-gated: explicit confirm before overwrite', async ({ page }) => {
  await connectViaStorage(page)
  await page.goto('/#/note/transcripts/california-day-one')
  await expect(page.locator('.canon-badge')).toContainText('canon')

  await page.getByTestId('edit-body').click()
  const editor = page.getByTestId('note-editor')
  await editor.press('Control+End')
  await editor.pressSequentially('\n[03:00] Addendum typed by the human.')
  await page.getByTestId('save-body').click()

  // No silent write: the gate appears, vault content still original.
  await expect(page.locator('.canon-confirm')).toBeVisible()
  let note = await mockNote(page, 'transcripts/california-day-one')
  expect(note.content).not.toContain('Addendum typed by the human.')
  await page.screenshot({ path: `${SHOTS}/06-canon-gate.png` })

  await page.getByTestId('canon-confirm').click()
  await expect(page.locator('.toast').last()).toContainText('Saved to vault')
  note = await mockNote(page, 'transcripts/california-day-one')
  expect(note.content).toContain('Addendum typed by the human.')
})

test('board: lanes in pipeline order, drag writes status to the vault', async ({ page }) => {
  await openScripts(page)
  await page.click('[role="tab"]:has-text("Board")')
  await expect(page).toHaveURL(/#\/scripts\/board/)

  const lanes = page.locator('.lane .lane-name')
  await expect(lanes).toHaveText([
    'idea',
    'draft',
    'approved',
    'filmed',
    'edited',
    'published',
  ])
  // idea is live and honest — dim, leftmost, populated.
  await expect(page.locator('.lane').first()).toHaveClass(/lane-dim/)
  await expect(
    page.locator('.lane[data-lane="idea"] .card'),
  ).toHaveCount(4)
  await page.screenshot({ path: `${SHOTS}/07-board.png`, fullPage: true })

  // Drag Bedtime Tuck-In from filmed → edited.
  const card = page.locator('.card', { hasText: 'Bedtime Tuck' })
  const target = page.locator('.lane[data-lane="edited"] .lane-head')
  const from = (await card.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / 12 + from.width / 2,
      from.y + ((to.y - from.y) * i) / 12 + from.height / 2,
    )
  }
  await page.mouse.up()

  await expect(
    page.locator('.lane[data-lane="edited"] .card', { hasText: 'Bedtime Tuck' }),
  ).toBeVisible()
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/bedtime-tuck-in')).metadata.status)
    .toBe('edited')

  // Undo puts it back — in the UI and in the vault.
  await page.click('.toast-action:has-text("Undo")')
  await expect(
    page.locator('.lane[data-lane="filmed"] .card', { hasText: 'Bedtime Tuck' }),
  ).toBeVisible()
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/bedtime-tuck-in')).metadata.status)
    .toBe('filmed')

  // A short press without movement opens the note instead of dragging.
  await page.locator('.card', { hasText: 'The Fake Map' }).click()
  await expect(page.getByTestId('note-page')).toBeVisible()
})

test('gallery: cards render chips and open the note page', async ({ page }) => {
  await openScripts(page)
  await page.click('[role="tab"]:has-text("Gallery")')
  await expect(page.locator('.gcard').first()).toBeVisible()
  await page.screenshot({ path: `${SHOTS}/08-gallery.png`, fullPage: true })

  const card = page.locator('.gcard', { hasText: 'Provider Ad V1' })
  await expect(card.locator('.chip')).toContainText(['approved'])
  await card.click()
  await expect(page.locator('.note-title')).toHaveText('Provider Ad V1')
})

test('capture: a new script lands in the vault with script defaults', async ({ page }) => {
  await openScripts(page)
  await page.click('.rail-new')
  await page.getByTestId('capture-title').fill('The Second Alarm Clock')
  await expect(page.locator('.capture-path')).toContainText(
    'content/scripts/the-second-alarm-clock',
  )
  await page.getByTestId('capture-body').fill('Nobody warns you about the second alarm clock.')
  await page.screenshot({ path: `${SHOTS}/09-capture.png` })
  await page.getByTestId('capture-create').click()

  await expect(page.locator('.note-title')).toHaveText('The Second Alarm Clock')
  const note = await mockNote(page, 'content/scripts/the-second-alarm-clock')
  expect([...note.tags].sort()).toEqual(['content/script', 'type/content'])
  expect(note.metadata.status).toBe('idea')
  expect(note.metadata.recorded).toBe('no')
  expect(note.metadata.source).toBe('brainstorm')
  expect(note.content).toContain('# The Second Alarm Clock')
  expect(note.content).toContain('Nobody warns you about the second alarm clock.')

  // It shows up in the dataset.
  await page.click('.rail-link:has-text("Scripts")')
  await expect(
    page.locator('.db-table tbody tr', { hasText: 'The Second Alarm Clock' }),
  ).toBeVisible()
})

test('library searches the whole vault; command palette jumps', async ({ page }) => {
  await openScripts(page)
  await page.click('.rail-link:has-text("Library")')
  await expect(page.locator('.lib-row').first()).toBeVisible()
  await page.fill('.library-search', 'analytics')
  await expect(page.locator('.lib-row')).toHaveCount(1)
  await page.screenshot({ path: `${SHOTS}/10-library.png` })
  await page.click('.lib-row')
  await expect(page.locator('.note-title')).toHaveText('The Analytics Gap')

  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.locator('.palette')).toBeVisible()
  await page.fill('.palette-input', 'bathtub')
  await page.keyboard.press('Enter')
  await expect(page.locator('.note-title')).toHaveText('The Bathtub Sales Call')
})

test('lens choice persists across reloads; disconnect wipes credentials', async ({ page }) => {
  await openScripts(page)
  await page.click('[role="tab"]:has-text("Board")')
  await expect(page.locator('.lane').first()).toBeVisible()
  await page.goto('/#/scripts')
  await expect(page.locator('.lane').first()).toBeVisible()

  await page.click('.rail-disconnect')
  await expect(page).toHaveURL(/#\/connect/)
  const stored = await page.evaluate(() => ({
    session: localStorage.getItem('atelier.session.v1'),
    legacy: localStorage.getItem('atelier.vault'),
  }))
  expect(stored.session).toBeNull()
  expect(stored.legacy).toBeNull()
})
