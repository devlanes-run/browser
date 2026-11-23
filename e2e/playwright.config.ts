import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  globalSetup: './global-setup.ts',
  // On Windows every test points the one registry key at its own host, so tests never overlap.
  workers: 1,
  fullyParallel: false,
  // A flaky test gets fixed at its cause, so a failure is never retried.
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [['list'], ['github']] : 'list'
});
