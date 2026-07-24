// <AskThePrimer> — the course-scoped Claude box. This spec proves the full
// flow without a real API key: it seeds primer notes in the mock vault, routes
// the Anthropic endpoint to a canned answer, then asks a question and asserts
// the grounded answer + citation line render. Mock-only.

import { test, expect, type Page } from '@playwright/test'

const MOCK = 'http://127.0.0.1:8787'
const TOKEN = 'atelier-test-token'
const AUTH = { Authorization: `Bearer ${TOKEN}` }
const NOTE_PATH = 'Atelier/Method/ai-primer/_ask-demo'

const PRIMER = [
  ['Atelier/Method/ai-primer/ai-primer-00-mental-model', '# Module 0\nEight layers: model, context window, system prompt, user prompt, tools, memory, orchestration, interface.', 0],
  ['Atelier/Method/ai-primer/ai-primer-03-memory', '# Module 3 — Memory\nContext window is short-term; memory persists across conversations.', 3],
  ['Atelier/Method/ai-primer/ai-primer-glossary', '# Glossary\n- **MCP** — USB-C for AI tools', undefined],
] as const

const ANSWER =
  'Memory and the context window are different layers. The context window (layer 2) ' +
  'is short-term working memory for one conversation.\n\nMemory (layer 6) persists ' +
  'across conversations. See Module 3 — Memory.'

async function seed(page: Page) {
  await page.request.post(`${MOCK}/__test/reset`)
  for (const [path, content, mod] of PRIMER) {
    await page.request.post(`${MOCK}/api/notes`, {
      headers: AUTH,
      data: { path, content, tags: ['ai-primer'], metadata: mod === undefined ? {} : { module_number: mod } },
    })
  }
  const res = await page.request.post(`${MOCK}/api/notes`, {
    headers: AUTH,
    data: {
      path: NOTE_PATH,
      extension: 'mdx',
      content: '## Ask demo\n\n<AskThePrimer />\n',
      tags: [],
      metadata: {},
    },
  })
  expect(res.status(), await res.text()).toBe(201)
}

test.skip(!!process.env.REAL_VAULT, 'mock-only spec')

test('<AskThePrimer>: grounded answer renders from a routed Claude call', async ({ page }) => {
  await seed(page)
  // Provide an API key and stub the Anthropic endpoint with a canned answer.
  await page.addInitScript(
    ([url, token]) => {
      localStorage.setItem('atelier.vault', JSON.stringify({ url, token }))
      localStorage.setItem('atelier.anthropicKey', 'sk-test-key')
    },
    [MOCK, TOKEN] as const,
  )
  await page.route('https://api.anthropic.com/v1/messages', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: ANSWER }] }),
    }),
  )

  await page.goto(`/#/note/${NOTE_PATH.split('/').map(encodeURIComponent).join('/')}`)
  const ask = page.getByTestId('note-body').locator('.mdx-ask')
  await expect(ask).toBeVisible()

  await ask.locator('.mdx-ask-input').fill('difference between memory and context window?')
  await ask.getByRole('button', { name: 'Ask' }).click()

  const answer = ask.locator('.mdx-ask-answer')
  await expect(answer).toContainText('persists across conversations')
  // Grounding excludes the underscore demo note; counts the 3 seeded primer notes.
  await expect(answer.locator('.mdx-ask-sources')).toContainText('Grounded in 3 course notes')
})
