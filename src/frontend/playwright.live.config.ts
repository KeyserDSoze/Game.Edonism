import { defineConfig, devices } from "@playwright/test";

/**
 * Dedicated real-browser/full-stack suite. Never import the mocked E2E tests.
 * Run only with the .NET Development API listening on 127.0.0.1:5080.
 */
export default defineConfig({
  testDir: "./e2e-live",
  timeout: 45_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium-live", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
