/**
 * Accounts made through the real UI: sign up, confirm from the dev email, sign in. Every e2e
 * account is `e2e-<role>-<run>@example.test`, so runs never collide and are easy to spot.
 */
import { expect, type Page } from "@playwright/test";
import { logOffset, waitForEmailLink } from "./mail";

export const PASSWORD = "e2e correct horse battery";

export function runId(): string {
  const id = process.env.E2E_RUN_ID;
  if (!id) throw new Error("[e2e] E2E_RUN_ID is not set (playwright.config.ts sets it).");
  return id;
}

/**
 * Run id plus a token per worker process. A retry runs in a fresh worker, so it never reuses the
 * failed attempt's accounts (the app rightly sends no new confirmation email to an existing one).
 */
const ATTEMPT = Math.random().toString(36).slice(2, 6);

export function uniqueTag(): string {
  return `${runId()}${ATTEMPT}`;
}

export function e2eEmail(role: string): string {
  return `e2e-${role}-${uniqueTag()}@example.test`;
}

/**
 * Opens a page and waits until it has settled. On a cold dev server the HTML arrives long before
 * React hydrates, and a form submitted in between posts natively and lands back on the same page.
 */
export async function gotoReady(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}

export interface Account {
  name: string;
  email: string;
}

/** Fills and submits the sign-up form, then follows the confirmation link (auto sign-in). */
export async function signUpAndConfirm(
  page: Page,
  { name, email, intent = "find" }: Account & { intent?: "find" | "list" },
): Promise<void> {
  await gotoReady(page, `/sign-up${intent === "list" ? "?intent=list" : ""}`);
  const form = page.locator("main form");
  await form.locator(`label[for$="${intent}"]`).first().click();
  await form.getByRole("textbox", { name: "Full name" }).fill(name);
  await form.getByRole("textbox", { name: "Email address" }).fill(email);
  await form.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  const offset = logOffset();
  await form.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/check-email/);

  const link = await waitForEmailLink(offset, { to: email, subject: /Confirm your email/ });
  await page.goto(link);
}

export async function signIn(page: Page, email: string, next?: string): Promise<void> {
  await gotoReady(page, next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in");
  const form = page.locator("main form");
  await form.getByRole("textbox", { name: "Email address" }).fill(email);
  await form.getByRole("textbox", { name: "Password", exact: true }).fill(PASSWORD);
  await form.getByRole("button", { name: /log in|sign in/i }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

/**
 * Onboarding after a "list" sign-up: lister type, display name and phone, then on to the account.
 * Waits for the streamed form first (the page shows a skeleton while it loads).
 */
export async function completeOnboarding(
  page: Page,
  { type, displayName, phone }: { type: "owner" | "agent"; displayName: string; phone: string },
): Promise<void> {
  await expect(page).toHaveURL(/\/account\/onboarding/);
  await page.waitForLoadState("networkidle");
  const profile = page.locator("main:visible form");
  await expect(profile.getByRole("button", { name: "Save and continue" })).toBeVisible();
  await profile.locator(`label[for$="${type}"]`).first().click();
  await profile.getByRole("textbox", { name: "Display name" }).fill(displayName);
  await profile.getByRole("textbox", { name: "Phone number" }).fill(phone);
  await profile.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).not.toHaveURL(/\/account\/onboarding/, { timeout: 60_000 });
}
