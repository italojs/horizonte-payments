import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // The faults apply to the entire simulated bank, so scenarios run in sequence.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 180_000,
  expect: { timeout: 65_000 },
  outputDir: 'test-results',
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    browserName: 'chromium',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
    locale: 'en-US',
    timezoneId: 'America/Sao_Paulo',
    viewport: { width: 1280, height: 850 },
  },
})
