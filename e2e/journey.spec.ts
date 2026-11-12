/**
 * Plan §12 flows 3 to 7, one lister's life in order (prompt S22 decision 7). Each step needs the
 * one before, so the file runs serially, desktop only:
 *   3 agent subscribes, creates and submits    4 admin approves, listing appears
 *   5 agent buys verification, moves to top    6 buyer inquires, agent replies
 *   7 plan lapses, listing pauses
 */
import type { Browser, Page } from "@playwright/test";
import { completeOnboarding, e2eEmail, gotoReady, signUpAndConfirm, uniqueTag } from "./support/accounts";
import { one, sql } from "./support/db";
import { expect, test, withFakeIp } from "./support/fixtures";
import { ADMIN_STATE } from "./support/paths";
import { makeListingPhotos } from "./support/photos";
import { runJob, simulatePayment } from "./support/scripts";
import { cards, main, results } from "./support/ui";

// Each step does real work over the Kenya-Frankfurt link (sign-ups, uploads, payments).
test.describe.configure({ mode: "serial", timeout: 420_000 });
test.skip(({ isMobile }) => isMobile, "The journey runs once, on desktop.");

/** Five described photos: the featured-listing bar. */
const PHOTOS = [
  "Front of the apartment block",
  "Living room with large windows",
  "Open kitchen with breakfast bar",
  "Main bedroom with fitted wardrobes",
  "Garden view from the balcony",
];

/** A tiny but real PDF: the document check sniffs the "%PDF-" signature. */
const PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

const agent = { name: `E2E Agent ${uniqueTag()}`, email: e2eEmail("agent") };
const buyer = { name: "E2E Inquirer", email: e2eEmail("inquirer") };
const listingTitle = `E2E ${uniqueTag()} 3-bedroom apartment in Lavington`;
const SEARCH = "/properties?q=Nairobi&mode=rent";
/** A made-up 07xx number per run: STK Push is rate-limited per phone, and runs must not share one. */
const PHONE = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

let agentPage: Page;
let listing: { id: string; slug: string };

async function adminPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  await withFakeIp(context);
  return context.newPage();
}

/** Starts an M-Pesa payment on the checkout page, settles it through the simulator, waits for success. */
async function payWithMpesa(page: Page, userEmail: string): Promise<void> {
  const form = main(page).locator("form");
  const phone = form.getByRole("textbox", { name: "M-Pesa number" });
  await phone.fill(PHONE);
  const started = new Date();
  await form.getByRole("button", { name: /^Pay KSh .* with M-Pesa$/ }).click();
  await expect(main(page).getByText("Check your phone")).toBeVisible();

  const payment = await one<{ checkout_request_id: string }>(
    `select p.checkout_request_id
       from payments p
       join invoices i on i.id = p.invoice_id
       join subscriptions s on s.id = i.subscription_id
       join users u on u.id = s.owner_user_id
      where u.email = $1 and p.created_at >= $2 and p.checkout_request_id is not null
      order by p.created_at desc limit 1`,
    [userEmail, new Date(started.getTime() - 5_000)],
  );
  simulatePayment(payment.checkout_request_id);
  await expect(main(page).getByText("Payment received")).toBeVisible({ timeout: 60_000 });
}

interface RankedCard {
  title: string;
  verified: boolean;
  lister: string;
}

/** Cards on page 1 of the Recommended rent search for Nairobi, in order, with badge and lister. */
async function recommendedOrder(page: Page): Promise<RankedCard[]> {
  await gotoReady(page, SEARCH);
  await expect(cards(results(page)).first()).toBeVisible();
  return cards(results(page)).evaluateAll((els) =>
    els.map((el) => ({
      title: el.querySelector("h3 a")?.textContent?.trim() ?? "",
      verified: /profile verified/i.test(el.textContent ?? ""),
      // The footer reads "Listed by <name>" (the first two words are screen-reader only).
      lister: (el.lastElementChild?.lastElementChild?.textContent ?? "").replace(/^\s*Listed by\s*/, "").trim(),
    })),
  );
}

/**
 * Plan §5: verified tier first, but at most 3 listings per lister in the first 20. A lister's 4th
 * and later listings drop below the tiers, so they are left out of the tier check.
 */
function expectVerifiedTierFirst(order: RankedCard[]): void {
  const seen = new Map<string, number>();
  const capped = order.map((card) => {
    const n = (seen.get(card.lister) ?? 0) + 1;
    seen.set(card.lister, n);
    return n > 3;
  });
  // Every capped card comes after every card that kept its place.
  const lastKept = capped.lastIndexOf(false);
  const firstCapped = capped.indexOf(true);
  if (firstCapped >= 0) expect(firstCapped).toBeGreaterThan(lastKept);
  // Among the kept cards, verified listers come first.
  const kept = order.filter((_, i) => !capped[i]);
  const lastVerified = kept.map((c) => c.verified).lastIndexOf(true);
  const firstUnverified = kept.findIndex((c) => !c.verified);
  if (lastVerified >= 0 && firstUnverified >= 0) expect(lastVerified).toBeLessThan(firstUnverified);
}

test.afterAll(async () => {
  await agentPage?.context().close();
});

test("3. an agent signs up, pays for Starter, creates a listing and submits it", async ({ browser }) => {
  const context = await browser.newContext();
  await withFakeIp(context);
  agentPage = await context.newPage();
  const page = agentPage;

  await signUpAndConfirm(page, { ...agent, intent: "list" });
  await completeOnboarding(page, { type: "agent", displayName: agent.name, phone: PHONE });
  await expect(page).toHaveURL(/\/account(\?|$)/);

  // Pricing -> Starter -> M-Pesa (simulated) -> active plan.
  await gotoReady(page, "/pricing");
  await main(page).getByRole("link", { name: "Choose Starter" }).click();
  await expect(page).toHaveURL(/\/account\/billing\/checkout\?plan=starter/);
  await payWithMpesa(page, agent.email);
  const plan = await one<{ status: string }>(
    `select s.status::text as status from subscriptions s join users u on u.id = s.owner_user_id
      where u.email = $1 and s.kind = 'listing'`,
    [agent.email],
  );
  expect(plan.status).toBe("active");

  // Basics.
  await gotoReady(page, "/account/listings/new");
  const basics = main(page).locator("form");
  await basics.getByRole("textbox", { name: "Listing title" }).fill(listingTitle);
  await basics.locator('label[for$="rent"]').first().click();
  await basics.getByRole("combobox", { name: "Property category" }).selectOption({ label: "Apartment" });
  await basics.getByRole("combobox", { name: "County" }).selectOption({ label: "Nairobi" });
  await basics.getByRole("textbox", { name: "Town" }).fill("Nairobi");
  await basics.getByRole("textbox", { name: "Area / neighbourhood" }).fill("Lavington");
  await basics.getByRole("textbox", { name: "Price (KSh)" }).fill("95000");
  await basics.getByRole("combobox", { name: "Rent is paid" }).selectOption({ label: "Per month" });
  await basics.getByRole("combobox", { name: "Bedrooms" }).selectOption({ label: "3" });
  await basics.getByRole("button", { name: "Continue" }).click();

  // Details.
  await expect(page).toHaveURL(/\/account\/listings\/[0-9a-f-]+\/details/);
  listing = await one<{ id: string; slug: string }>(`select id, slug from properties where title = $1`, [listingTitle]);
  const details = main(page).locator("form");
  await details
    .getByRole("textbox", { name: "Description" })
    .fill("A bright three-bedroom apartment on a quiet Lavington road, close to schools and shops. Made by the e2e suite.");
  await details.getByRole("textbox", { name: "Bathrooms" }).fill("2");
  await details.getByRole("button", { name: "Continue" }).click();

  // Photos: five described uploads (the featured bar).
  await expect(page).toHaveURL(/\/photos/);
  await main(page)
    .locator('input[type="file"]')
    .first()
    .setInputFiles(await makeListingPhotos(PHOTOS.length));
  const staged = main(page).getByRole("list", { name: "Photos to upload" });
  const describe = staged.getByRole("textbox", { name: "Describe this photo" });
  await expect(describe).toHaveCount(PHOTOS.length);
  for (let i = 0; i < PHOTOS.length; i++) await describe.nth(i).fill(PHOTOS[i]);
  await main(page).getByRole("button", { name: `Upload ${PHOTOS.length} photos` }).click();
  await expect(main(page).getByRole("list", { name: "Listing photos" }).getByRole("listitem")).toHaveCount(PHOTOS.length, {
    timeout: 120_000,
  });
  await main(page).getByRole("link", { name: "Continue" }).click();

  // Preview -> submit. An unverified lister's listing waits for review.
  await expect(page).toHaveURL(/\/preview/);
  await main(page).getByRole("button", { name: "Submit for review" }).click();
  await expect
    .poll(async () => (await one<{ status: string }>(`select status::text as status from properties where id = $1`, [listing.id])).status)
    .toBe("pending_review");
});

/** Call and WhatsApp reach the agent's number (WhatsApp defaults to "same as phone"). */
async function expectContactButtons(page: Page) {
  const e164 = `+254${PHONE.slice(1)}`;
  await expect(main(page).getByRole("link", { name: /^Call/ }).first()).toHaveAttribute("href", `tel:${e164}`);
  const whatsapp = main(page).getByRole("link", { name: /^WhatsApp/ }).first();
  const href = await whatsapp.getAttribute("href");
  // A prefix check, not a RegExp: in a template string "\." and "\?" lose their backslashes.
  expect(href?.startsWith(`https://wa.me/${e164.slice(1)}?text=`), `WhatsApp href ${href}`).toBe(true);
  expect(new URL(href!).searchParams.get("text")).toContain(listingTitle);
  await expect(whatsapp).toHaveAttribute("target", "_blank");
}

test("4. an admin approves the listing and it appears in search", async ({ browser }) => {
  const page = await adminPage(browser);
  await gotoReady(page, "/admin/listings");
  await main(page).getByRole("link", { name: listingTitle }).click();
  await main(page).getByRole("button", { name: "Approve and publish" }).click();
  await expect
    .poll(async () => (await one<{ status: string }>(`select status::text as status from properties where id = $1`, [listing.id])).status)
    .toBe("published");
  await page.context().close();

  // Public: in search, and its own page opens for an anonymous visitor.
  const visitor = await browser.newContext();
  const anon = await visitor.newPage();
  await gotoReady(anon, "/properties?q=Lavington&mode=rent");
  await expect(cards(results(anon)).filter({ hasText: listingTitle })).toHaveCount(1);
  await gotoReady(anon, `/properties/${listing.slug}`);
  await expect(main(anon).getByRole("heading", { level: 1, name: listingTitle })).toBeVisible();

  // Contact rule, unverified lister (prompt lister-contact-buttons): a signed-out visitor gets a
  // sign-in prompt, and the number is nowhere in the page, RSC payload included.
  await expect(main(anon).getByRole("link", { name: "Sign in to see contact details" })).toBeVisible();
  await expect(main(anon).getByRole("link", { name: /^Call/ })).toHaveCount(0);
  expect(await anon.content()).not.toContain(PHONE.slice(1));
  await visitor.close();

  // Any signed-in visitor (here the admin) gets the buttons without sending a message first.
  const signedIn = await adminPage(browser);
  await gotoReady(signedIn, `/properties/${listing.slug}`);
  await expectContactButtons(signedIn);
  await signedIn.context().close();
});

test("5. the agent pays for verification, is approved and ranks with the verified tier", async ({ browser }) => {
  const page = agentPage;
  const before = await recommendedOrder(page);
  expectVerifiedTierFirst(before);
  const ownBefore = before.findIndex((c) => c.title === listingTitle);
  expect(ownBefore).toBeGreaterThanOrEqual(0);
  expect(before[ownBefore].verified).toBe(false);

  // Pay for verification, then upload every required document and submit.
  await gotoReady(page, "/account/verification");
  await main(page).getByRole("link", { name: /verif/i }).filter({ hasText: /KSh|start|get|pay/i }).first().click();
  await expect(page).toHaveURL(/checkout\?plan=verification/);
  await payWithMpesa(page, agent.email);
  await gotoReady(page, "/account/verification");
  const inputs = main(page).locator('input[type="file"][aria-label^="Add a file for"]');
  const labels = await inputs.evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  expect(labels.length).toBeGreaterThan(0);
  for (const [i, label] of labels.entries()) {
    await main(page)
      .locator(`input[aria-label="${label}"]`)
      .setInputFiles({ name: `e2e-document-${i + 1}.pdf`, mimeType: "application/pdf", buffer: PDF });
    // Each stored file is listed as "PDF · <size>".
    await expect(main(page).getByText(/^PDF ·/)).toHaveCount(i + 1, { timeout: 60_000 });
  }
  await main(page).getByRole("button", { name: "Submit for review" }).click();
  await expect(main(page).getByText(/in review|under review|submitted/i).first()).toBeVisible();

  // Admin approves.
  const admin = await adminPage(browser);
  await gotoReady(admin, "/admin/verification");
  await main(admin).getByRole("link", { name: new RegExp(agent.name) }).first().click();
  // Approve stays disabled until the reviewer ticks every checklist item.
  const checklist = main(admin).getByRole("checkbox");
  await expect(checklist.first()).toBeVisible();
  for (const box of await checklist.all()) await box.check();
  await expect(main(admin).getByRole("button", { name: "Approve verification" })).toBeEnabled();
  await main(admin).getByRole("button", { name: "Approve verification" }).click();
  await expect(main(admin).getByText(/approved|verified/i).first()).toBeVisible();
  await admin.context().close();

  // The badge shows and the listing sits in the verified tier, above every unverified listing.
  const after = await recommendedOrder(page);
  expectVerifiedTierFirst(after);
  const own = after.findIndex((c) => c.title === listingTitle);
  expect(own).toBeGreaterThanOrEqual(0);
  expect(after[own].verified).toBe(true);
  // It moved up, and now sits above every unverified listing.
  expect(own).toBeLessThan(ownBefore);
  const firstUnverified = after.findIndex((c) => !c.verified);
  if (firstUnverified >= 0) expect(own).toBeLessThan(firstUnverified);

  // Strict sorts show it in the labelled verified strip.
  await gotoReady(page, `${SEARCH}&sort=newest`);
  const strip = main(page).locator("section").filter({ has: page.getByRole("heading", { name: "Verified listers" }) });
  await expect(strip).toBeVisible();

  // Verified: the contact buttons are open to every visitor, signed out included.
  const visitor = await browser.newContext();
  const anon = await visitor.newPage();
  await gotoReady(anon, `/properties/${listing.slug}`);
  await expectContactButtons(anon);
  await visitor.close();
});

test("6. a buyer inquires and the agent replies", async ({ browser }) => {
  const context = await browser.newContext();
  await withFakeIp(context);
  const page = await context.newPage();
  await signUpAndConfirm(page, buyer);

  await gotoReady(page, `/properties/${listing.slug}`);
  const question = `Is it available from next month? (${uniqueTag()})`;
  const inquiry = main(page).locator("form").filter({ has: page.getByRole("button", { name: "Request a viewing" }) });
  // The message field sits in a <details> that starts closed; open it only if it is.
  const details = inquiry.locator("details").first();
  if ((await details.count()) > 0 && !(await details.evaluate((el) => (el as HTMLDetailsElement).open))) {
    await details.locator("summary").click();
  }
  await inquiry.getByRole("textbox", { name: "Message" }).fill(question);
  await inquiry.getByRole("button", { name: "Request a viewing" }).click();
  await expect(page.getByText(question).first()).toBeVisible({ timeout: 60_000 });

  // The agent sees it and replies.
  await gotoReady(agentPage, "/account/messages");
  await main(agentPage).getByRole("link", { name: new RegExp(buyer.name) }).first().click();
  await expect(main(agentPage).getByText(question)).toBeVisible();
  const reply = `Yes, from the 1st. (${uniqueTag()})`;
  await main(agentPage).getByPlaceholder("Write a message…").fill(reply);
  await main(agentPage).getByRole("button", { name: "Send" }).click();
  await expect(main(agentPage).getByText(reply)).toBeVisible();

  // The buyer's open thread picks the reply up by polling.
  await expect(page.getByText(reply)).toBeVisible({ timeout: 90_000 });
  await context.close();
});

test("7. the plan lapses past grace and the listing pauses", async () => {
  // Fixture write on the e2e branch: the 30-day period ended 4 days ago, so the 3-day grace is over.
  await sql(
    `update subscriptions s set current_period_start = now() - interval '34 days',
            current_period_end = now() - interval '4 days', grace_ends_at = now() - interval '1 day'
       from users u where u.id = s.owner_user_id and u.email = $1 and s.kind = 'listing'`,
    [agent.email],
  );
  runJob("grace-expiry");

  const row = await one<{ status: string }>(`select status::text as status from properties where id = $1`, [listing.id]);
  expect(row.status).toBe("paused");

  const page = agentPage;
  await gotoReady(page, "/properties?q=Lavington&mode=rent");
  await expect(cards(results(page)).filter({ hasText: listingTitle })).toHaveCount(0);
  await gotoReady(page, `/properties/${listing.slug}`);
  await expect(main(page).getByRole("heading", { name: "Page not found" })).toBeVisible();

  await gotoReady(page, "/account/listings");
  const own = main(page).locator("li, tr, article").filter({ hasText: listingTitle }).first();
  await expect(own).toContainText(/paused/i);
});
