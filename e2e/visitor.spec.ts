/**
 * Plan §12 flow 1: a visitor searches and opens a property (desktop and mobile).
 * Read-only: no account, no writes.
 */
import { gotoReady } from "./support/accounts";
import { expect, test } from "./support/fixtures";
import { cardPrices, cards, cardTitles, expectNotFound, main, results, verifiedStrip } from "./support/ui";

test.describe("visitor", () => {
  test("searches, filters, sorts and opens a property", async ({ page }) => {
    await gotoReady(page, "/");
    const home = main(page);
    await home.getByPlaceholder("County, town or area").fill("Nairobi");
    await home.getByRole("button", { name: /search/i }).first().click();

    await expect(page).toHaveURL(/\/properties\?.*q=Nairobi/);
    await expect(cards(main(page)).first()).toBeVisible();
    // Never a draft, pending or rejected sample.
    for (const title of await cardTitles(main(page))) {
      expect(title).not.toMatch(/should never appear publicly/i);
    }

    // Rent only, cheapest first.
    await gotoReady(page, "/properties?q=Nairobi&mode=rent");
    await page.getByRole("combobox", { name: /sort by/i }).selectOption("price_asc");
    await expect(page).toHaveURL(/sort=price_asc/);
    await expect(cards(results(page)).first()).toBeVisible();
    const prices = await cardPrices(results(page));
    expect(prices.length).toBeGreaterThan(1);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
    // Strict sorts carry at most 3 verified listings in their own labelled strip.
    expect(await cards(verifiedStrip(page)).count()).toBeLessThanOrEqual(3);

    // Open the first result.
    const first = cards(results(page)).first();
    const title = (await first.locator("h3 a").innerText()).trim();
    await first.locator("h3 a").click();
    await expect(page).toHaveURL(/\/properties\/[a-z0-9-]+$/);
    await expect(main(page).getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(main(page).getByText(/KSh\s[\d,]+/).first()).toBeVisible();
    await expect(main(page).locator("img:visible").first()).toBeVisible();
  });

  test("shows the not-found page for a listing that doesn't exist or isn't public", async ({ page }) => {
    await gotoReady(page, "/properties/no-such-listing-e2e");
    await expectNotFound(page);
    await gotoReady(page, "/properties/sample-draft-listing");
    await expectNotFound(page);
  });

  test("shows the not-found page for an agency that doesn't exist or has nothing published", async ({ page }) => {
    // Prompt S23 decision 11: agency pages exist only while the agency has a published listing.
    await gotoReady(page, "/agencies/no-such-agency-e2e");
    await expectNotFound(page);
  });
});
