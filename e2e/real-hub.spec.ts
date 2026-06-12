// Gold-standard OAuth verification: drives the app's "Connect with OAuth"
// against a GENUINE Parachute hub + vault running locally (started from the
// open-source checkouts) — real login form, real consent screen, real dynamic
// client registration/approval, real PKCE validation, real hub-signed JWTs,
// real refresh rotation.
//
// Run:  REAL_HUB=1 npx playwright test e2e/real-hub.spec.ts
// Requires the local stack (hub :1939, vault :1940, seeded) and a write JWT
// in /tmp/real-vault-token.txt for out-of-band assertions.

import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { makeSeed } from './seed.mjs'

test.skip(!process.env.REAL_HUB, 'requires the local real hub stack')

const VAULT = 'http://127.0.0.1:1940/vault/jonathan'
const USERNAME = 'adam'
const PASSWORD = 'atelier-e2e-pass-7'
const SHOTS = 'e2e/.shots'

const JWT = (() => {
  try {
    return readFileSync('/tmp/real-vault-token.txt', 'utf8').trim()
  } catch {
    return ''
  }
})()
const AUTH = { Authorization: `Bearer ${JWT}` }

async function reseed(page: Page) {
  const list = await page.request.get(`${VAULT}/api/notes?limit=1000`, { headers: AUTH })
  for (const n of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${VAULT}/api/notes/${encodeURIComponent(n.id)}`, {
      headers: AUTH,
    })
  }
  const created = await page.request.post(`${VAULT}/api/notes`, {
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

async function vaultNote(page: Page, path: string) {
  const res = await page.request.get(
    `${VAULT}/api/notes?id=${encodeURIComponent(path)}&include_content=true`,
    { headers: AUTH },
  )
  expect(res.ok()).toBeTruthy()
  return res.json()
}

test('real hub: OAuth sign-in end to end — login, consent, read, write, restore', async ({
  page,
  context,
}) => {
  test.setTimeout(120_000)
  await reseed(page)

  // 1. Connect screen → Connect with OAuth.
  await page.goto('/')
  await page.fill('input[name="vault-url"]', VAULT)
  await page.getByTestId('connect-oauth').click()

  // 2. The hub takes over: sign in on ITS login form when asked.
  await page.waitForURL(/127\.0\.0\.1:1939/)
  await page.screenshot({ path: `${SHOTS}/13-real-hub-page.png` })
  if (await page.locator('input[name="username"]').count()) {
    await page.fill('input[name="username"]', USERNAME)
    await page.fill('input[name="password"]', PASSWORD)
    await page.screenshot({ path: `${SHOTS}/14-real-hub-login.png` })
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.click('button[type="submit"], input[type="submit"]'),
    ])
  }

  // 3. Consent screen (vault picker + Approve) — or an inline client-approval
  //    step first; handle whatever the hub presents.
  for (let i = 0; i < 3 && page.url().includes(':1939'); i++) {
    await page.screenshot({ path: `${SHOTS}/15-real-hub-consent-${i}.png` })
    const approve = page.getByRole('button', { name: /approve|allow|authorize/i }).first()
    await expect(approve).toBeVisible()
    await approve.click()
    await page
      .waitForURL((u) => !u.toString().includes(':1939'), { timeout: 10_000 })
      .catch(() => {})
  }

  // 4. Back in the app. Either signed in, or our pending-approval UI — if the
  //    hub deferred client approval to the token exchange, approve and retry.
  await page.waitForURL(/127\.0\.0\.1:4173/)
  const approveBox = page.getByTestId('approve-box')
  if (await approveBox.isVisible().catch(() => false)) {
    await page.screenshot({ path: `${SHOTS}/16-real-approval-needed.png` })
    const [hubPage] = await Promise.all([
      context.waitForEvent('page'),
      page.getByTestId('approve-link').click(),
    ])
    await hubPage.waitForLoadState()
    const hubApprove = hubPage.getByRole('button', { name: /approve/i }).first()
    if (await hubApprove.isVisible().catch(() => false)) await hubApprove.click()
    await hubPage.close()
    await page.getByTestId('approve-retry').click()
    for (let i = 0; i < 3 && page.url().includes(':1939'); i++) {
      const approve = page.getByRole('button', { name: /approve|allow|authorize/i }).first()
      if (await approve.isVisible().catch(() => false)) await approve.click()
      await page
        .waitForURL((u) => !u.toString().includes(':1939'), { timeout: 10_000 })
        .catch(() => {})
    }
    await page.waitForURL(/127\.0\.0\.1:4173/)
  }

  // 5. Signed in: the seeded scripts load through hub-issued OAuth tokens.
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.db-table tbody tr')).toHaveCount(17)
  await page.screenshot({ path: `${SHOTS}/17-real-signed-in.png` })

  // The session carries hub refresh material and the resolved vault URL.
  const session = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('atelier.session.v1')))!,
  )
  expect(session.mode).toBe('oauth')
  expect(session.token.refreshToken).toBeTruthy()
  expect(session.tokenEndpoint).toContain(':1939')

  // 6. A write lands in the real vault under the OAuth access token.
  const row = page.locator('.db-table tbody tr', { hasText: 'The Fake Map' })
  await row.locator('.chip-btn[data-field="status"]').click()
  await page.click('.popover .menu-item:has(.chip:text-is("approved"))')
  await expect
    .poll(async () => (await vaultNote(page, 'content/scripts/the-fake-map')).metadata.status, {
      timeout: 10_000,
    })
    .toBe('approved')

  // 7. Reload — the session restores with no re-login.
  await page.reload()
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible({ timeout: 15_000 })
  await expect(page).not.toHaveURL(/#\/connect/)
})
