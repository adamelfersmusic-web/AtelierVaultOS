// Showcase capture: an interactive "Module 0" built from Adam's real
// ai-primer content, deploying every course MDX component together —
// <LayerStack>, <Term>, <Checklist>, <LayerQuiz>. Mock-only; it seeds the
// note through the vault REST API and screenshots the rendered result.

import { test, expect, type Page } from '@playwright/test'

const MOCK = 'http://127.0.0.1:8787'
const TOKEN = 'atelier-test-token'
const AUTH = { Authorization: `Bearer ${TOKEN}` }
const NOTE_PATH = 'Atelier/Method/ai-primer/_module-0-interactive'
const GLOSSARY_PATH = 'Atelier/Method/ai-primer/ai-primer-glossary'

// A trimmed copy of the real glossary note — <Term> fetches this over REST.
const GLOSSARY = `# AI Primer — Glossary

- **Context window** — the model's working memory for the current conversation → [[ai-primer-01-core-terminology]]
- **RAG (Retrieval-Augmented Generation)** — retrieving relevant documents before answering → [[ai-primer-01-core-terminology]]
- **Hallucination** — confident fabricated output presented as fact; structural, not a bug → [[ai-primer-01-core-terminology]]
`

const MDX = `## Module 0 — The Mental Model (interactive)

Every AI product — ChatGPT, Claude, a Notion AI feature, a customer-service bot —
is the same **eight layers** stacked on each other. Click any layer to open it.

<LayerStack />

The single highest-leverage habit in the whole primer: when a confusing new
buzzword shows up, ask **which layer is this?** A <Term id="context-window">context window</Term>
is layer two. And when a term like <Term id="rag">RAG</Term> shows up, its
definition is pulled live from your glossary note. Drill it:

<LayerQuiz term="MCP" answer="Tools" />

<LayerQuiz term="chain of thought" answer="User prompt" />

When Module 4 zooms in on the hands-and-gear layer, the same stack can spotlight it:

<LayerStack highlight="tools" />

### Before you move on

<Checklist items={[
  "I can name all eight layers without looking",
  "I can place a new buzzword on the stack",
  "I know why context window is not the same as memory"
]} />

If those three are solid, you're ready for Module 1.
`

async function seed(page: Page) {
  await page.request.post(`${MOCK}/__test/reset`)
  // The glossary note <Term> fetches from, plus the interactive module note.
  for (const [path, content] of [
    [GLOSSARY_PATH, GLOSSARY],
    [NOTE_PATH, MDX],
  ] as const) {
    const res = await page.request.post(`${MOCK}/api/notes`, {
      headers: AUTH,
      data: { path, extension: path === NOTE_PATH ? 'mdx' : 'md', content, tags: [], metadata: {} },
    })
    expect(res.status(), await res.text()).toBe(201)
  }
}

async function connect(page: Page) {
  await page.addInitScript(
    ([url, token]) => localStorage.setItem('atelier.vault', JSON.stringify({ url, token })),
    [MOCK, TOKEN] as const,
  )
}

test.skip(!!process.env.REAL_VAULT, 'mock-only spec')

test('showcase: interactive Module 0 renders every course component', async ({ page }) => {
  await seed(page)
  await connect(page)
  await page.goto(`/#/note/${NOTE_PATH.split('/').map(encodeURIComponent).join('/')}`)

  const body = page.getByTestId('note-body')
  await expect(body).toBeVisible()

  // The stack rendered all eight layers.
  await expect(body.locator('.mdx-stack').first().locator('.mdx-stack-row')).toHaveCount(8)
  // The quiz rendered its eight options.
  await expect(body.locator('.mdx-quiz').first().locator('.mdx-quiz-opt')).toHaveCount(8)
  // The checklist rendered its three items.
  await expect(body.locator('.mdx-checklist input[type=checkbox]')).toHaveCount(3)
  await page.screenshot({ path: 'e2e/.shots/showcase-01-fresh.png', fullPage: true })

  // <Term id="rag"> pulls its definition LIVE from the seeded glossary note.
  await body.getByRole('button', { name: 'RAG', exact: true }).click()
  const ragDef = body.locator('.mdx-term-def')
  await expect(ragDef).toContainText('retrieving relevant documents before answering')
  await expect(ragDef.locator('.mdx-term-src')).toContainText('from your glossary')

  // Open a layer in the stack.
  await body.locator('.mdx-stack').first().getByRole('button', { name: /Context window/ }).click()
  await expect(body.locator('.mdx-stack-detail').first()).toBeVisible()

  // Answer the MCP quiz correctly (Tools) and tick the checklist.
  const quiz = body.locator('.mdx-quiz').first()
  await quiz.getByRole('button', { name: 'Tools', exact: true }).click()
  await expect(quiz.locator('.mdx-quiz-verdict.is-win')).toBeVisible()
  await body.locator('.mdx-checklist input[type=checkbox]').first().check()
  await body.locator('.mdx-checklist input[type=checkbox]').nth(1).check()

  await page.screenshot({ path: 'e2e/.shots/showcase-02-interacted.png', fullPage: true })
})
