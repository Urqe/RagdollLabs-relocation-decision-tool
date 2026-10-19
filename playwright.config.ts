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
  ],
  webServer: {
    command: `node scripts/serve.ts ${PORT}`,
    url: `http://localhost:${PORT}/RagdollLabs-relocation-decision-tool/`,
    reuseExistingServer: !process.env.CI,
  },
});
