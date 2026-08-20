import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3100';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    colorScheme: 'dark',
    viewport: { width: 1280, height: 720 },
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    // Narrow viewport without device emulation: exercises the responsive CSS
    // with a layout viewport that matches the visual one.
    { name: 'narrow', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    // Real device emulation, for the touch drawer contract.
    { name: 'mobile', use: { ...devices['Pixel 5'] } },
  ],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: 'npm run build && npm run start -- -p 3100',
        url: `${BASE_URL}/health/live`,
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
