/**
 * Plan §12 flow 2: a buyer registers (confirming the email from the dev log) and saves a property.
 */
import { e2eEmail, gotoReady, signUpAndConfirm } from "./support/accounts";
import { one } from "./support/db";
import { expect, test } from "./support/fixtures";
import { cards, main } from "./support/ui";

const LISTING = { slug: "sample-kilimani-2br-apartment", title: "Sample: Bright 2-bedroom apartment in Kilimani" };

test("a buyer registers, confirms the email, and saves a listing", async ({ page }) => {
  const email = e2eEmail("buyer");
  await signUpAndConfirm(page, { name: "E2E Buyer", email });

  // Signed in after the link; the account exists with a verified email and the buyer role only.
  const user = await one<{ email_verified: boolean; roles: string[] }>(
    `select u.email_verified, array(select r.role::text from user_roles r where r.user_id = u.id) as roles
       from users u where u.email = $1`,
    [email],
  );
  expect(user.email_verified).toBe(true);
  expect(user.roles).toEqual(["buyer_tenant"]);

  await gotoReady(page, `/properties/${LISTING.slug}`);
  await expect(main(page).getByRole("heading", { level: 1, name: LISTING.title })).toBeVisible();
  const save = main(page).getByRole("button", { name: "Save listing" }).first();
  await save.click();
  await expect(main(page).getByRole("button", { name: "Remove from saved" }).first()).toBeVisible();

  await gotoReady(page, "/account/saved");
  await expect(cards(main(page)).filter({ hasText: LISTING.title })).toHaveCount(1);

  // Unsave from the saved page; the card goes.
  await cards(main(page)).filter({ hasText: LISTING.title }).getByRole("button", { name: "Remove from saved" }).click();
  // The page refreshes itself once the action is done; reload only after that, or it races.
  await expect(cards(main(page)).filter({ hasText: LISTING.title })).toHaveCount(0);
  await page.reload();
  await expect(cards(main(page)).filter({ hasText: LISTING.title })).toHaveCount(0);
});
