/**
 * The run's platform admin (prompt S22 decision 4): signs up through the UI, confirms the email,
 * then gets platform_admin through the operator script, against the e2e branch only. The signed-in
 * state is saved for the specs that act as admin.
 */
import { e2eEmail, signUpAndConfirm } from "./support/accounts";
import { ADMIN_STATE } from "./support/paths";
import { expect, test } from "./support/fixtures";
import { grantPlatformAdmin } from "./support/scripts";

test("create the run's platform admin", async ({ page }) => {
  const email = e2eEmail("admin");
  await signUpAndConfirm(page, { name: "E2E Admin", email });
  const { output } = grantPlatformAdmin(email);
  expect(output).toContain("granted");

  await page.goto("/admin");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.locator("main")).not.toContainText(/not found|sign in/i);
  await page.context().storageState({ path: ADMIN_STATE });
});

/**
 * Each run starts from a clean `.next-e2e`, so every route compiles on first use, and a heavy
 * page could take over a minute (run 8: the admin review page). Request every route the suite
 * uses once, signed in as admin, before any test runs. Unknown ids still compile the route.
 */
const WARM_ROUTES = [
  "/",
  "/properties",
  "/properties/sample-kilimani-2br-apartment",
  "/pricing",
  "/how-it-works",
  "/privacy",
  "/privacy/request",
  "/terms",
  "/subscription-policy",
  "/moderation",
  "/sign-in",
  "/forgot-password",
  "/check-email",
  "/account",
  "/account/onboarding",
  "/account/profile",
  "/account/listings",
  "/account/listings/new",
  "/account/listings/00000000-0000-4000-8000-000000000000/basics",
  "/account/listings/00000000-0000-4000-8000-000000000000/details",
  "/account/listings/00000000-0000-4000-8000-000000000000/photos",
  "/account/listings/00000000-0000-4000-8000-000000000000/preview",
  "/account/billing",
  "/account/billing/checkout?plan=starter",
  "/account/verification",
  "/account/messages",
  "/account/messages/00000000-0000-4000-8000-000000000000",
  "/account/saved",
  "/account/settings",
  "/admin",
  "/admin/listings",
  "/admin/listings/00000000-0000-4000-8000-000000000000",
  "/admin/verification",
  "/admin/verification/00000000-0000-4000-8000-000000000000",
  "/admin/billing",
  "/admin/jobs",
  "/admin/reports",
  "/admin/data-requests",
];

test("warm up the dev server's routes", async ({ browser }) => {
  test.setTimeout(900_000);
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  for (const route of WARM_ROUTES) {
    const response = await context.request.get(route, { timeout: 240_000, maxRedirects: 0 }).catch(() => null);
    expect(response, `warm-up request for ${route}`).not.toBeNull();
  }
  await context.close();
});
