// Knowledge-graph drive against the mock vault's seed (22 notes, 18 links —
// shaped like the real vault: a transcript hub, one canon bloom, a
// supersedes edge, orphans at the rim). Mock-only; skipped in REAL_VAULT mode.

import { test, expect, type Page } from '@playwright/test'

const MOCK = 'http://127.0.0.1:8787'
const TOKEN = 'atelier-test-token'
const SHOTS = 'e2e/.shots'

test.skip(Boolean(process.env.REAL_VAULT), 'mock-only graph suite')

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK}/__test/reset`)
  await page.addInitScript(
    ([url, token]) => {
      localStorage.setItem(
        'atelier.session.v1',
        JSON.stringify({ vaultUrl: url, mode: 'token', token: { accessToken: token } }),
      )
    },
    [MOCK, TOKEN] as const,
  )
})

async function openGraph(page: Page) {
  await page.goto('/#/scripts/table')
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()
  await page.click('.rail-link:has-text("Graph")')
  await expect(page).toHaveURL(/#\/graph/)
  await expect(page.getByTestId('graph-stats')).toBeVisible({ timeout: 10_000 })
}

test('graph nav: sidebar entry, full-bleed canvas, all notes load as nodes', async ({ page }) => {
  await openGraph(page)
  // The sidebar collapses — full canvas.
  await expect(page.locator('.rail')).toHaveCount(0)
  await expect(page.getByTestId('graph-stats')).toHaveText('22 notes · 18 links')
  await expect(page.locator('.gnode')).toHaveCount(22)
  // The malformed seed note (no metadata, no tags) renders faint, not a crash.
  await expect(
    page.locator('.gnode[data-path="logs/raw-orphan-no-metadata"]'),
  ).toHaveCount(1)
  // Hub labels only (degree ≥ 8): exactly the transcript hub in this seed.
  await expect(page.locator('.gnode-label')).toHaveCount(1)
  await expect(page.locator('.gnode-label')).toHaveText('California Day One')
  // The canon note blooms gold.
  await expect(
    page.locator('.gnode[data-path="brand/05-content-pillars"] .gnode-bloom'),
  ).toHaveCount(1)
  // Wordmark + back affordance present.
  await expect(page.locator('.graph-wordmark')).toContainText('Atelier')
  await page.waitForTimeout(2400) // settle + blooms + edges
  await page.screenshot({ path: `${SHOTS}/20-graph-seed.png` })
})

test('axis toggle remaps color and adds the verification ring', async ({ page }) => {
  await openGraph(page)
  const core = page.locator('.gnode[data-path="intel/the-analytics-gap"] .gnode-core')
  // Verification axis (default): ANALYSIS-VERIFIED → cool dim white, no rings.
  await expect(core).toHaveAttribute('fill', '#c3c9d0')
  await expect(page.locator('.gnode-ring')).toHaveCount(0)

  await page.click('.graph-axis-btn:has-text("Domain")')
  // domain/analytics → red, and every node gains a verification ring.
  await expect(core).toHaveAttribute('fill', '#C4445A')
  await expect(page.locator('.gnode-ring')).toHaveCount(22)
  await expect(page.getByTestId('graph-legend')).toContainText('analytics')

  await page.click('.graph-axis-btn:has-text("Lifecycle")')
  await expect(core).toHaveAttribute('fill', '#4A7FA5') // todo → faint blue

  await page.click('.graph-axis-btn:has-text("Verification")')
  await expect(core).toHaveAttribute('fill', '#c3c9d0')
  await expect(page.locator('.gnode-ring')).toHaveCount(0)
  // Axis choice persists.
  await page.click('.graph-axis-btn:has-text("Type")')
  await page.reload()
  await expect(page.getByTestId('graph-stats')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.graph-axis-btn.is-active')).toHaveText('Type')
})

test('hover shows the tooltip; click opens the existing note page in a drawer', async ({ page }) => {
  await openGraph(page)
  await page.waitForTimeout(1800) // let the constellation settle
  const hub = page.locator('.gnode[data-path="transcripts/california-day-one"]')
  await hub.hover({ force: true })
  await expect(page.locator('.graph-tooltip')).toContainText('California Day One')
  await expect(page.locator('.graph-tooltip-tag')).toHaveText('#transcript')

  await hub.click({ force: true })
  const drawer = page.getByTestId('graph-drawer')
  await expect(drawer).toBeVisible()
  await expect(drawer.getByTestId('note-page')).toBeVisible()
  await expect(drawer.locator('.note-title')).toHaveText('California Day One')
  // It's the real, editable note view — canon badge included.
  await expect(drawer.locator('.canon-badge')).toContainText('canon')
  await page.screenshot({ path: `${SHOTS}/21-graph-drawer.png` })

  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  // Still on the graph (escape only closed the drawer).
  await expect(page).toHaveURL(/#\/graph/)
})

test('pan, zoom, and double-click reset-to-fit', async ({ page }) => {
  await openGraph(page)
  await page.waitForTimeout(1800)
  const root = page.locator('.graph-svg > g')
  const before = await root.getAttribute('transform')

  // Drag empty space → pan.
  await page.mouse.move(200, 640)
  await page.mouse.down()
  await page.mouse.move(330, 560, { steps: 6 })
  await page.mouse.up()
  const panned = await root.getAttribute('transform')
  expect(panned).not.toBe(before)

  // Wheel → zoom (scale factor changes).
  const scaleOf = (t: string | null) => Number(/scale\(([\d.]+)/.exec(t ?? '')?.[1] ?? 1)
  await page.mouse.wheel(0, -240)
  await expect.poll(async () => scaleOf(await root.getAttribute('transform'))).not.toBe(
    scaleOf(panned),
  )

  // Double-click empty space → animated reset to fit.
  await page.mouse.dblclick(160, 660)
  await expect
    .poll(async () => root.getAttribute('transform'), { timeout: 3000 })
    .toBe(before)
})

test('back arrow returns to the previous view', async ({ page }) => {
  await openGraph(page)
  await page.getByTestId('graph-back').click()
  await expect(page).toHaveURL(/#\/scripts/)
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()
})

test('command palette jumps to the graph', async ({ page }) => {
  await page.goto('/#/scripts/table')
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()
  await page.keyboard.press('ControlOrMeta+k')
  await page.fill('.palette-input', 'graph')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/#\/graph/)
  await expect(page.getByTestId('graph-stats')).toBeVisible({ timeout: 10_000 })
})
