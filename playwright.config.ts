import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    viewport: { width: 1440, height: 880 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node e2e/mock-vault.mjs',
      url: 'http://127.0.0.1:8787/api/health',
      reuseExistingServer: true,
      timeout: 15_000,
    },
    {
      command: 'npm run preview',
      url: 'http://127.0.0.1:4173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
