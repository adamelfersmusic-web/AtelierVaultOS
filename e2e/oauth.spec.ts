// OAuth 2.1 + PKCE journey tests against the mock hub (which implements the
// protocol surface faithfully: RFC 8414 discovery, RFC 7591 DCR, S256 PKCE
// verification, single-use codes, strict refresh-token rotation, and the
// hub's invalid_client + approve_url pending-approval case).
//
// These drive the real browser redirect dance — app → hub page → back with
// ?code&state — not a simulated callback. Mock-only (they use the mock's
// control plane), so they're skipped in REAL_VAULT mode.

import { test, expect, type Page } from '@playwright/test'

const MOCK = 'http://127.0.0.1:8787'
const STATIC_TOKEN = 'atelier-test-token'
const SHOTS = 'e2e/.shots'

test.skip(Boolean(process.env.REAL_VAULT), 'mock-only OAuth suite')

test.beforeEach(async ({ page }) => {
  await page.request.post(`${MOCK}/__test/reset`)
})

async function oauthState(page: Page) {
  const res = await page.request.get(`${MOCK}/__test/oauth-state`)
  return res.json()
}

async function mockNote(page: Page, path: string) {
  const res = await page.request.get(
    `${MOCK}/__test/note?path=${encodeURIComponent(path)}`,
  )
  expect(res.ok()).toBeTruthy()
  return res.json()
}

/** Click through the full OAuth dance: connect screen → hub → back, signed in. */
async function signInWithOAuth(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/#\/connect/)
  await page.fill('input[name="vault-url"]', MOCK)
  await page.getByTestId('connect-oauth').click()
  await page.waitForURL(/oauth\/authorize/)
  await expect(page.locator('h1')).toHaveText('Mock Parachute Hub')
  await page.click('#approve')
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()
}

test('full OAuth journey: sign in on the hub, read, write, reload-restore', async ({ page }) => {
  await page.goto('/')
  await page.screenshot({ path: `${SHOTS}/11-connect-oauth.png` })

  await signInWithOAuth(page)

  // The dynamic registration used the proven public-client shape.
  const state = await oauthState(page)
  expect(state.clientCount).toBe(1)
  expect(state.lastRegistration.token_endpoint_auth_method).toBe('none')
  expect(state.lastRegistration.grant_types).toEqual([
    'authorization_code',
    'refresh_token',
  ])
  expect(state.lastRegistration.redirect_uris).toEqual(['http://127.0.0.1:4173/'])

  // OAuth params were stripped from the URL by history.replaceState.
  expect(new URL(page.url()).search).toBe('')

  // Session persisted with refresh material; client_id cached per issuer.
  const session = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('atelier.session.v1')))!,
  )
  expect(session.mode).toBe('oauth')
  expect(session.vaultUrl).toBe(MOCK) // resolved via the token's services catalog
  expect(session.token.refreshToken).toBeTruthy()
  expect(session.token.expiresAt).toBeGreaterThan(Date.now())
  expect(session.clientId).toMatch(/^mock-client-/)
  const clients = await page.evaluate(() => localStorage.getItem('atelier.oauth.clients'))
  expect(clients).toContain(session.clientId)

  // A write lands in the vault under the OAuth access token.
  await page.click('[role="tab"]:has-text("Board")')
  const card = page.locator('.card', { hasText: 'The Fake Map' })
  const target = page.locator('.lane[data-lane="approved"] .lane-head')
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
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/the-fake-map')).metadata.status)
    .toBe('approved')

  // Reload: the session restores without re-login.
  await page.reload()
  await expect(page.locator('.lane').first()).toBeVisible()
  await expect(page).not.toHaveURL(/#\/connect/)
})

test('reactive refresh: a 401 triggers refresh-token rotation and a replay', async ({ page }) => {
  await signInWithOAuth(page)
  const before = await oauthState(page)

  // The hub invalidates the access token out-of-band (refresh stays valid).
  await page.request.post(`${MOCK}/__test/oauth`, { data: { revokeAccess: true } })

  // A cell edit must silently refresh + replay — no visible failure.
  const row = page.locator('.db-table tbody tr', { hasText: 'The Fake Map' })
  await row.locator('.chip-btn[data-field="conviction"]').click()
  await page.click('.popover .menu-item:has(.chip:text-is("strong"))')
  await expect
    .poll(async () => (await mockNote(page, 'content/scripts/the-fake-map')).metadata.conviction)
    .toBe('strong')

  const after = await oauthState(page)
  expect(after.rotationCount).toBeGreaterThan(before.rotationCount)

  // The rotation was persisted: the stored refresh token is the current one.
  const session = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('atelier.session.v1')))!,
  )
  expect(session.token.refreshToken).toBe(after.currentRefreshToken)
})

test('proactive refresh: tokens near expiry rotate before requests, silently', async ({ page }) => {
  // Tokens are issued already inside the 30s proactive-refresh window.
  await page.request.post(`${MOCK}/__test/oauth`, { data: { expiresIn: 10 } })
  await signInWithOAuth(page)

  const state = await oauthState(page)
  expect(state.rotationCount).toBeGreaterThanOrEqual(1)

  // Still fully functional after rotation, and the rotation was persisted.
  const session = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('atelier.session.v1')))!,
  )
  expect(session.token.refreshToken).toBe(state.currentRefreshToken)
  await page.fill('.db-search', 'fake map')
  await expect(page.locator('.db-table tbody tr')).toHaveCount(1)
})

test('pending approval: the hub approve_url is surfaced as a clickable link', async ({ page }) => {
  await page.request.post(`${MOCK}/__test/oauth`, { data: { approvalMode: true } })

  await page.goto('/')
  await page.fill('input[name="vault-url"]', MOCK)
  await page.getByTestId('connect-oauth').click()
  await page.waitForURL(/oauth\/authorize/)
  await page.click('#approve')

  // Token exchange returned invalid_client + approve_url → approval UI.
  const box = page.getByTestId('approve-box')
  await expect(box).toBeVisible()
  const href = await page.getByTestId('approve-link').getAttribute('href')
  expect(href).toContain('/oauth/approve')
  await page.screenshot({ path: `${SHOTS}/12-approval.png` })

  // The human approves on the hub, then retries sign-in.
  await page.request.get(href!)
  await page.getByTestId('approve-retry').click()
  await page.waitForURL(/oauth\/authorize/)
  await page.click('#approve')
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()
})

test('hub-denied sign-in (?error=) lands back with a readable error', async ({ page }) => {
  await page.goto('/?error=access_denied&error_description=You+cancelled+the+sign-in')
  await expect(page.locator('.connect-error')).toContainText('You cancelled the sign-in')
  expect(new URL(page.url()).search).toBe('')
})

test('v1 token-paste config migrates to the new session format', async ({ page }) => {
  await page.addInitScript(
    ([url, token]) => {
      localStorage.setItem('atelier.vault', JSON.stringify({ url, token }))
    },
    [MOCK, STATIC_TOKEN] as const,
  )
  await page.goto('/#/scripts/table')
  await expect(page.locator('.db-table tbody tr').first()).toBeVisible()

  const migrated = JSON.parse(
    (await page.evaluate(() => localStorage.getItem('atelier.session.v1')))!,
  )
  expect(migrated).toEqual({
    vaultUrl: MOCK,
    mode: 'token',
    token: { accessToken: STATIC_TOKEN },
  })
  expect(await page.evaluate(() => localStorage.getItem('atelier.vault'))).toBeNull()
})

test('disconnect clears session, refresh material, and cached client ids', async ({ page }) => {
  await signInWithOAuth(page)
  await page.click('.rail-disconnect')
  await expect(page).toHaveURL(/#\/connect/)

  const storage = await page.evaluate(() => ({
    session: localStorage.getItem('atelier.session.v1'),
    legacy: localStorage.getItem('atelier.vault'),
    clients: localStorage.getItem('atelier.oauth.clients'),
    pending: sessionStorage.getItem('atelier.oauth.pending'),
  }))
  expect(storage.session).toBeNull()
  expect(storage.legacy).toBeNull()
  expect(storage.clients).toBeNull()
  expect(storage.pending).toBeNull()
})
