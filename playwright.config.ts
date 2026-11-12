import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { E2E_DATA_DIR, E2E_ORIGIN, loadEnvFiles } from "./e2e/support/env";

/**
 * End-to-end suite (prompt S22). Local only: it needs the Neon e2e branch and Edge.
 *   npm run e2e                       every spec, desktop and mobile
 *   npm run e2e -- e2e/journey.spec.ts one file
 *   npm run e2e:report                 open the last HTML report
 */
loadEnvFiles();
// One id per run, shared with the workers (they inherit the runner's environment).
process.env.E2E_RUN_ID ??= Date.now().toString(36);

const edge = { channel: "msedge" as const };

export default defineConfig({
  testDir: "e2e",
  // Traces and screenshots are written while tests run. Outside the project, or the dev server's
  // file watcher sees them and reloads the page under test.
  outputDir: path.join(E2E_DATA_DIR, "test-results"),
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  // One retry for the occasional dropped connection on the Kenya-Frankfurt link.
  retries: 1,
  timeout: 180_000,
  // Generous: pages stream from Neon in Frankfurt, and the Kenya link has slow spells (requests of
  // 20 to 37 s were seen in S22 run 5).
  expect: { timeout: 60_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: E2E_ORIGIN,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 120_000,
    actionTimeout: 60_000,
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/, use: { ...devices["Desktop Edge"], ...edge } },
    {
      name: "desktop",
      dependencies: ["setup"],
      testMatch: /.*\.spec\.ts/,
      use: { ...devices["Desktop Edge"], ...edge, viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      dependencies: ["setup"],
      testMatch: /(visitor|forms|a11y)\.spec\.ts/,
      use: {
        ...edge,
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices["Pixel 7"].userAgent,
      },
    },
  ],
  webServer: {
    command: "node --import tsx e2e/server.ts",
    url: `${E2E_ORIGIN}/api/health`,
    // E2E_REUSE_SERVER=yes reuses a server you started with `node --import tsx e2e/server.ts`.
    reuseExistingServer: process.env.E2E_REUSE_SERVER === "yes",
    timeout: 180_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
