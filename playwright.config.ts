import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', timeout: 60_000, expect: { timeout: 12_000 }, fullyParallel: false, workers: 1,
  reporter: 'list', use: { baseURL: 'http://localhost:3000', channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true, viewport: { width: 1440, height: 960 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
  webServer: { command: 'npm run dev', url: 'http://localhost:3000/health', reuseExistingServer: !process.env.CI, timeout: 30_000 }
});
