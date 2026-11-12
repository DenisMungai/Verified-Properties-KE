/**
 * Plan §12 flow 8: invalid forms show accessible errors and keep the typed values (desktop and
 * mobile). For each form: every bad field is aria-invalid with its error as the accessible
 * description, focus moves to the first bad field, and what was typed is still there. Passwords
 * are not refilled after a failed sign-up (deliberate: the browser never gets it back).
 */
import type { Locator, Page } from "@playwright/test";
import { e2eEmail, gotoReady, signUpAndConfirm } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { main } from "./support/ui";

async function expectFieldError(field: Locator, message: RegExp): Promise<void> {
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await expect(field).toHaveAccessibleDescription(message);
}

async function expectFocused(page: Page, field: Locator): Promise<void> {
  await expect(field).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.getAttribute("aria-invalid"))).toBe("true");
}

test("sign-up: a bad email and a short password", async ({ page }) => {
  await gotoReady(page, "/sign-up");
  const form = main(page).locator("form");
  await form.getByRole("textbox", { name: "Full name" }).fill("Form Tester");
  await form.getByRole("textbox", { name: "Email address" }).fill("not-an-email");
  await form.getByRole("textbox", { name: "Password", exact: true }).fill("short");
  await form.getByRole("button", { name: "Create account" }).click();

  const email = form.getByRole("textbox", { name: "Email address" });
  await expectFieldError(email, /email/i);
  await expectFieldError(form.getByRole("textbox", { name: "Password", exact: true }), /at least/i);
  await expectFocused(page, email);
  await expect(form.getByRole("textbox", { name: "Full name" })).toHaveValue("Form Tester");
  await expect(email).toHaveValue("not-an-email");
});

test("lister forms: profile phone, listing basics, data request", async ({ page }) => {
  const email = e2eEmail(`forms-${test.info().project.name}`);
  await signUpAndConfirm(page, { name: "Form Lister", email, intent: "list" });

  // Onboarding profile: an impossible phone number.
  await expect(page).toHaveURL(/\/account\/onboarding/);
  const profile = main(page).locator("form");
  await profile.locator('label[for$="owner"]').first().click();
  await profile.getByRole("textbox", { name: "Display name" }).fill("Form Lister Homes");
  const phone = profile.getByRole("textbox", { name: "Phone number" });
  await phone.fill("12345");
  await profile.getByRole("button", { name: "Save and continue" }).click();
  await expectFieldError(phone, /Enter a Kenyan mobile number/);
  await expectFocused(page, phone);
  await expect(phone).toHaveValue("12345");
  await expect(profile.getByRole("textbox", { name: "Display name" })).toHaveValue("Form Lister Homes");
  await expect(profile.getByRole("radio", { name: /owner/i })).toBeChecked();
  await phone.fill("0700000123");

  // A separate WhatsApp number that isn't one: its own error, and the unticked box stays unticked.
  const sameAsPhone = profile.getByRole("checkbox", { name: /WhatsApp is on the same phone number/ });
  await expect(sameAsPhone).toBeChecked();
  await sameAsPhone.uncheck();
  const whatsapp = profile.getByRole("textbox", { name: /WhatsApp number/ });
  await whatsapp.fill("999");
  await profile.getByRole("button", { name: "Save and continue" }).click();
  await expectFieldError(whatsapp, /Enter a Kenyan mobile number/);
  await expectFocused(page, whatsapp);
  await expect(whatsapp).toHaveValue("999");
  await expect(sameAsPhone).not.toBeChecked();
  await whatsapp.fill("0700000124");
  await profile.getByRole("button", { name: "Save and continue" }).click();
  await expect(page).not.toHaveURL(/\/account\/onboarding/);

  // Listing basics: a too-short title and a negative price.
  await gotoReady(page, "/account/listings/new");
  const basics = main(page).locator("form");
  const title = basics.getByRole("textbox", { name: "Listing title" });
  await title.fill("Flat");
  await basics.locator('label[for$="sale"]').first().click();
  await basics.getByRole("combobox", { name: "Property category" }).selectOption({ label: "House" });
  await basics.getByRole("combobox", { name: "County" }).selectOption({ label: "Kiambu" });
  await basics.getByRole("textbox", { name: "Town" }).fill("Ruiru");
  await basics.getByRole("combobox", { name: "Bedrooms" }).selectOption({ label: "4" });
  const price = basics.getByRole("textbox", { name: "Price (KSh)" });
  await price.fill("-5000");
  await basics.getByRole("button", { name: "Continue" }).click();
  await expectFieldError(price, /price|KSh/i);
  const firstInvalid = basics.locator('[aria-invalid="true"]').first();
  await expectFocused(page, firstInvalid);
  await expect(basics.getByRole("textbox", { name: "Town" })).toHaveValue("Ruiru");
  await expect(price).toHaveValue("-5000");
  // Selects too (finding E1): React's post-action form reset used to clear them.
  await expect(basics.getByRole("combobox", { name: "County" })).toHaveValue(/kiambu/i);
  await expect(basics.getByRole("combobox", { name: "Bedrooms" })).toHaveValue("4");
  await expect(basics.getByRole("combobox", { name: "Property category" })).toHaveValue("house");
  await expect(basics.getByRole("radio", { name: "Sale" })).toBeChecked();
  // A second failed submit keeps them as well.
  await basics.getByRole("button", { name: "Continue" }).click();
  await expect(price).toHaveAttribute("aria-invalid", "true");
  await expect(basics.getByRole("combobox", { name: "County" })).toHaveValue(/kiambu/i);
  await expect(basics.getByRole("combobox", { name: "Bedrooms" })).toHaveValue("4");

  // Data request: nothing chosen and too few details.
  await gotoReady(page, "/privacy/request");
  const request = main(page).locator("form").filter({ has: page.getByRole("radio") });
  const details = request.getByRole("textbox", { name: /details/i });
  await details.fill("Hi");
  await request.getByRole("button").last().click();
  await expectFieldError(details, /at least/i);
  await expect(request.getByRole("group", { name: "What do you want to do?" })).toHaveAccessibleDescription(/choose/i);
  await expect(details).toHaveValue("Hi");
});
