import { defineConfig } from '@playwright/test';

// Loads the built extension (dist-e2e/) in headless Chromium. Every page is served from
// tests/fixtures by request interception; nothing goes to the real network.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
});
