// Visual review of the graph against the REAL vault structure. Run with:
//   MOCK_REAL_GRAPH=1 node e2e/mock-vault.mjs &   (requires e2e/real-graph/*)
//   VISUAL=1 npx playwright test e2e/visual.spec.ts
// Screenshots land in e2e/.shots/ for human review. Not part of CI.

import { test, expect } from '@playwright/test'

const MOCK = 'http://127.0.0.1:8787'
const TOKEN = 'atelier-test-token'
const SHOTS = 'e2e/.shots'

test.skip(!process.env.VISUAL, 'visual review only')

test('real constellation: all axes, settled', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(
    ([url, token]) => {
      localStorage.setItem(
        'atelier.session.v1',
        JSON.stringify({ vaultUrl: url, mode: 'token', token: { accessToken: token } }),
      )
    },
    [MOCK, TOKEN] as const,
  )
  await page.goto('/#/graph')
  await expect(page.getByTestId('graph-stats')).toBeVisible({ timeout: 20_000 })
  const stats = await page.getByTestId('graph-stats').textContent()
  console.log('REAL GRAPH:', stats)

  await page.waitForTimeout(2600) // form + settle + blooms
  await page.screenshot({ path: `${SHOTS}/30-real-verification.png` })

  for (const axis of ['Domain', 'Type', 'Lifecycle']) {
    await page.click(`.graph-axis-btn:has-text("${axis}")`)
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}/31-real-${axis.toLowerCase()}.png` })
  }

  await page.click('.graph-axis-btn:has-text("Verification")')
  await page.waitForTimeout(600)
  // Zoom into the densest region for a close-up.
  await page.mouse.move(720, 440)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${SHOTS}/32-real-zoomed.png` })
})
