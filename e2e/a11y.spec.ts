/**
 * Accessibility audit (plan §12; prompt S22 decision 8), desktop and mobile:
 * - axe-core, WCAG 2.1 A and AA, on every public, auth, account and admin page listed below
 * - no horizontal scroll (desktop also at 320px and at 640px, i.e. 1280px at 200% zoom)
 * - 44px targets (32px for the documented secondary controls)
 * - keyboard: skip link, visible focus on every tab stop, menus and the filter sheet open and close
 *   with the keyboard and hand focus back
 * Every page is checked fully before the test fails, so one run lists every problem.
 */
import type { Page } from "@playwright/test";
import { completeOnboarding, e2eEmail, signUpAndConfirm } from "./support/accounts";
import { axeFindings, focusVisible, horizontalOverflow, smallTargets } from "./support/a11y";
import { expect, test, withFakeIp } from "./support/fixtures";
import { ADMIN_STATE } from "./support/paths";
import { main } from "./support/ui";

const PUBLIC_PAGES = [
  "/",
  "/properties",
  "/properties?q=Nairobi&mode=rent&sort=newest",
  "/properties?q=nowhere-at-all",
  "/properties/sample-kilimani-2br-apartment",
  "/pricing",
  "/how-it-works",
  "/privacy",
  "/privacy/request",
  "/terms",
  "/subscription-policy",
  "/moderation",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
];

const LISTER_PAGES = [
  "/account",
  "/account/onboarding",
  "/account/profile",
  "/account/listings",
  "/account/listings/new",
  "/account/billing",
  "/account/billing/checkout?plan=starter",
  "/account/verification",
  "/account/messages",
  "/account/saved",
  "/account/settings",
];

const ADMIN_PAGES = [
  "/admin",
  "/admin/listings",
  "/admin/verification",
  "/admin/billing",
  "/admin/jobs",
  "/admin/reports",
  "/admin/data-requests",
];

async function settle(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(main(page).first()).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

/** Runs every check on one page and records failures softly, so all pages get checked. */
async function auditPage(page: Page, path: string, isMobile: boolean): Promise<void> {
  await settle(page, path);
  // Metadata streams in on dynamic pages; on a slow link axe could otherwise run before the
  // <title> arrives. A page with no title at all still fails here.
  await expect(page, `title on ${path}`).toHaveTitle(/\S/);
  const axe = await axeFindings(page);
  expect.soft(axe, `axe on ${path}`).toEqual([]);
  expect.soft(await horizontalOverflow(page), `horizontal scroll on ${path}`).toEqual([]);
  expect.soft(await smallTargets(page), `small targets on ${path}`).toEqual([]);

  if (!isMobile) {
    const size = page.viewportSize()!;
    for (const width of [320, 640]) {
      await page.setViewportSize({ width, height: width === 320 ? 640 : 400 });
      await page.waitForTimeout(150);
      expect.soft(await horizontalOverflow(page), `horizontal scroll at ${width}px on ${path}`).toEqual([]);
    }
    await page.setViewportSize(size);
  }
}

test.describe("accessibility", () => {
  test("public and auth pages", async ({ page, isMobile }) => {
    test.setTimeout(600_000);
    for (const path of PUBLIC_PAGES) await auditPage(page, path, isMobile);
  });

  test("lister account pages", async ({ page, isMobile }) => {
    test.setTimeout(600_000);
    const email = e2eEmail(`a11y-${test.info().project.name}`);
    await signUpAndConfirm(page, { name: "A11y Lister", email, intent: "list" });
    await completeOnboarding(page, { type: "owner", displayName: "A11y Lister Homes", phone: "0700000155" });
    for (const path of LISTER_PAGES) await auditPage(page, path, isMobile);
  });

  test("admin pages", async ({ browser, isMobile }) => {
    test.setTimeout(600_000);
    test.skip(isMobile, "Admin pages are audited at desktop width; their mobile layout is covered by the 320px check.");
    const context = await browser.newContext({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });
    await withFakeIp(context);
    const page = await context.newPage();
    for (const path of ADMIN_PAGES) await auditPage(page, path, false);
    await context.close();
  });
});

test.describe("keyboard", () => {
  for (const path of ["/", "/properties", "/sign-in"]) {
    test(`tab order and visible focus on ${path}`, async ({ page, isMobile }) => {
      test.skip(isMobile, "Keyboard checks run at desktop width.");
      await settle(page, path);
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus")).toHaveText("Skip to content");
      await page.keyboard.press("Enter");
      await expect.poll(() => page.evaluate(() => location.hash)).toBe("#main");

      // Back to the top, then walk the first 40 tab stops.
      await settle(page, path);
      const missing: string[] = [];
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press("Tab");
        const focus = await focusVisible(page);
        if (focus.what === "nothing focused") break;
        if (focus.what.startsWith("nextjs-portal")) continue; // Next.js dev tools, absent in production
        if (!focus.ok) missing.push(focus.what);
      }
      expect(missing, `tab stops without a visible focus style on ${path}`).toEqual([]);
    });
  }

  test("after a sort change, focus stays on the sort control (finding A5)", async ({ page, isMobile }) => {
    test.skip(isMobile, "Keyboard checks run at desktop width.");
    await settle(page, "/properties?mode=rent");
    const sort = page.getByRole("combobox", { name: /sort by/i });
    await sort.focus();
    // Headless Edge doesn't fire change on ArrowDown over a closed select; selectOption fires the
    // same change event a keyboard choice does, with focus still on the control.
    // Retried until React has hydrated the control: before that, nothing listens for change.
    // selectOption fires change on every call, even when the value is already "newest".
    await expect(async () => {
      await sort.selectOption("newest");
      await expect(page).toHaveURL(/sort=newest/, { timeout: 10_000 });
    }).toPass({ timeout: 90_000 });
    await expect(sort).toHaveValue("newest");
    await expect(sort).toBeFocused();
  });

  test("the mobile menu and the filter sheet open and close with the keyboard", async ({ page, isMobile }) => {
    test.skip(!isMobile, "These controls exist below md only.");
    await settle(page, "/");
    const opener = page.getByRole("button", { name: "Open menu" });
    await opener.focus();
    await page.keyboard.press("Enter");
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(opener).toBeFocused();

    await settle(page, "/properties");
    const filters = main(page).getByRole("button", { name: /^Filters/ });
    await filters.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("heading", { name: "Filters" });
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(filters).toBeFocused();
  });

  test("the account menu opens and closes with the keyboard", async ({ browser, isMobile }) => {
    test.skip(isMobile, "The account menu is a desktop control.");
    const context = await browser.newContext({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });
    await withFakeIp(context);
    const page = await context.newPage();
    await settle(page, "/");
    const opener = page.locator("header").getByRole("button", { name: /E2E Admin/ });
    await opener.focus();
    await page.keyboard.press("Enter");
    await expect(opener).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(opener).toHaveAttribute("aria-expanded", "false");
    await expect(opener).toBeFocused();
    await context.close();
  });
});
