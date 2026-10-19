import { defineConfig, devices } from 'playwright/test';

const PORT = 4173;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}/RagdollLabs-relocation-decision-tool/`,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true } },
    // iPad-sized layout in Chromium, so it runs everywhere.
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true } },
    // WebKit runs in CI, where its browser is installed; set WEBKIT=1 to run it locally.
    ...(process.env.CI || process.env.WEBKIT
      ? [
          { name: 'webkit-desktop', use: { ...devices['Desktop Safari'] } },
          { name: 'webkit-ipad', use: { ...devices['iPad (gen 7)'] } },
        ]
      : []),
  ],
  webServer: {
    command: `node scripts/serve.ts ${PORT}`,
    url: `http://localhost:${PORT}/RagdollLabs-relocation-decision-tool/`,
    reuseExistingServer: !process.env.CI,
  },
});
