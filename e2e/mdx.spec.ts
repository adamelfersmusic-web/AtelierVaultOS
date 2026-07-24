// Runtime MDX rendering — the end-to-end proof that a note fetched with
// extension "mdx" is compiled in the browser and its <Term> component
// renders, expands on click, and that the unimplemented <Checklist> /
// <LayerQuiz> components degrade instead of crashing the page.
//
// Mock-only: it seeds a fresh mdx note through the vault's REST API, so it
// never touches the shared seed or any other spec. Skipped against a real
// vault (that content lives there already; no need to write to it here).

import { test, expect, type Page } from '@playwright/test'

const MOCK = 'http://127.0.0.1:8787'
const TOKEN = 'atelier-test-token'
const AUTH = { Authorization: `Bearer ${TOKEN}` }

const NOTE_PATH = 'Atelier/Method/ai-primer/_mdx-roundtrip-test'

// The test note's body, byte-identical to what the live vault stores.
const MDX = `## MDX round-trip test

Plain markdown still works — **bold**, \`code\`, [[wikilinks]].

Now a component in the middle of prose. A <Term id="context-window">context window</Term> is layer two.

<Checklist items={[
  "Vault stores the markup verbatim",
  "Extension is mdx",
  "Nothing gets escaped or stripped"
]} />

<LayerQuiz term="MCP" answer="Tools" />

If the text above came back byte-identical, the record side is solved and the only remaining work is the renderer.
`

async function seedMdxNote(page: Page) {
  await page.request.post(`${MOCK}/__test/reset`)
  const res = await page.request.post(`${MOCK}/api/notes`, {
    headers: AUTH,
    data: { path: NOTE_PATH, extension: 'mdx', content: MDX, tags: [], metadata: {} },
  })
  expect(res.status(), await res.text()).toBe(201)
}

/** Pre-authorize the app by seeding the legacy token config (migrated on load). */
async function connect(page: Page) {
  await page.addInitScript(
    ([url, token]) => {
      localStorage.setItem('atelier.vault', JSON.stringify({ url, token }))
    },
    [MOCK, TOKEN] as const,
  )
}

test.skip(!!process.env.REAL_VAULT, 'mock-only spec')

test('mdx note: <Term> renders, expands on click, others degrade', async ({ page }) => {
  await seedMdxNote(page)
  await connect(page)
  await page.goto(`/#/note/${NOTE_PATH.split('/').map(encodeURIComponent).join('/')}`)

  const body = page.getByTestId('note-body')
  await expect(body).toBeVisible()

  // Plain markdown around the component still renders.
  await expect(body).toContainText('layer two')
  await expect(body.locator('p strong')).toHaveText('bold')

  // <Term> rendered as an interactive term with the dotted underline.
  const term = body.locator('.mdx-term')
  await expect(term).toHaveText('context window')
  await expect(term).toHaveCSS('text-decoration-style', 'dotted')
  await expect(term).toHaveAttribute('aria-expanded', 'false')
  await page.screenshot({ path: 'e2e/.shots/mdx-term-collapsed.png' })

  // Definition is hidden until clicked, then expands beneath the term.
  await expect(body.locator('.mdx-term-def')).toHaveCount(0)
  await term.click()
  await expect(term).toHaveAttribute('aria-expanded', 'true')
  await expect(body.locator('.mdx-term-def')).toContainText('model can consider')
  await page.screenshot({ path: 'e2e/.shots/mdx-term-expanded.png' })

  // <Checklist> and <LayerQuiz> now render as real interactive components.
  await expect(body.locator('.mdx-checklist input[type=checkbox]')).toHaveCount(3)
  await expect(body.locator('.mdx-quiz .mdx-quiz-opt')).toHaveCount(8)
  await expect(body).toContainText('the record side is solved')
})
