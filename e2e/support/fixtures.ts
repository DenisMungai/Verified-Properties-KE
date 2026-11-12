/**
 * Shared test fixtures (prompt S22 decision 7):
 * - every browser context gets its own fake client IP, added only to requests for the e2e server
 *   (never `extraHTTPHeaders`: it would leak cross-origin and break storage CORS preflights).
 *   The in-memory sign-up limit is per IP, so each context starts fresh.
 * - the database pool is closed once the worker is done.
 */
import { test as base, type BrowserContext } from "@playwright/test";
import { closeDb } from "./db";
import { E2E_ORIGIN } from "./env";

let ipCounter = Math.floor(Math.random() * 200);

export function nextFakeIp(): string {
  ipCounter = (ipCounter + 1) % 250;
  // 198.18.0.0/15 is reserved for benchmarking: never a real client.
  return `198.18.${Math.floor(Math.random() * 250)}.${ipCounter + 1}`;
}

export async function withFakeIp(context: BrowserContext, ip = nextFakeIp()): Promise<void> {
  await context.route(`${E2E_ORIGIN}/**`, (route) =>
    route.continue({ headers: { ...route.request().headers(), "x-forwarded-for": ip } }),
  );
}

export const test = base.extend<object, { dbCleanup: void }>({
  // Playwright calls the second fixture argument `use`; named `provide` here so the React hooks
  // lint rule doesn't mistake it for a hook.
  context: async ({ context }, provide) => {
    await withFakeIp(context);
    await provide(context);
  },
  dbCleanup: [
    async ({}, provide) => {
      await provide();
      await closeDb();
    },
    { scope: "worker", auto: true },
  ],
});

export { expect } from "@playwright/test";
