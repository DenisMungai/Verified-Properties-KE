/** Small page helpers shared by the specs. Roles, labels and text only; no CSS classes. */
import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Next 16 keeps earlier routes mounted as hidden <Activity> trees, so the same heading or
 * form can exist twice in the DOM. Scope to what is visible.
 */
export function main(page: Page): Locator {
  return page.locator("main:visible");
}

/** Result and rail cards: each is an <article> whose title link (h3 a) covers the card. */
export function cards(scope: Locator): Locator {
  return scope.locator("article:visible").filter({ has: scope.page().locator("h3 a") });
}

export async function cardTitles(scope: Locator): Promise<string[]> {
  return (await cards(scope).locator("h3 a").allInnerTexts()).map((t) => t.trim());
}

/** "KSh 85,000 / month" -> 85000 */
export function kes(text: string): number {
  const digits = /KSh\s*([\d,]+)/.exec(text)?.[1];
  if (!digits) throw new Error(`[e2e] no KSh amount in "${text}"`);
  return Number(digits.replace(/,/g, ""));
}

export async function cardPrices(scope: Locator): Promise<number[]> {
  // The price is the first paragraph of each card.
  const texts = await cards(scope).evaluateAll((els) => els.map((el) => el.querySelector("p")?.textContent ?? ""));
  return texts.map(kes);
}

/** The main result list of /properties (not the verified strip above it). */
export function results(page: Page): Locator {
  return main(page)
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: /^Results/ }) });
}

/** The labelled strip of up to 3 verified listings on strict sorts (plan §5). */
export function verifiedStrip(page: Page): Locator {
  return main(page)
    .locator("section")
    .filter({ has: page.getByRole("heading", { level: 2, name: "Verified listers" }) });
}

export async function expectNotFound(page: Page): Promise<void> {
  await expect(main(page).getByRole("heading", { name: "Page not found" })).toBeVisible();
}
