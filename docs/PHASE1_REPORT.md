# Phase 1 exit report

**Status: complete. Every Phase 1 exit criterion passed.** Four findings are listed at the end.
F2–F4 were fixed on 5 November (`prompts/s11-exit-fixes.md`). F1 is accepted as a framework limit.

- Run date: 5 November 2026 (times in UTC)
- Target: Neon `dev` branch (`ep-weathered-cloud-b9h4jvv4`), which the live site
  https://verifiedpropertieske.vercel.app also reads
- App: local `next dev` at commit `0c1b563` (S11 seed), driven with Edge through `playwright-core`
- Payments: Daraja **sandbox** (paybill 174379). Callbacks land on the live site.
- Prompt: `prompts/s11-seed-exit.md`

## Exit criteria

| # | Criterion (plan v2.0 §9) | Result | Evidence |
|---|---|---|---|
| 1 | An agent signs up | **Pass** | `agent+exit1105@example.test` (user `OAVj4YICmaVpuZashYbL5Jnpi0fc0MVI`) signed up, confirmed the email from the dev-log link and landed on onboarding. |
| 2 | …pays for a Starter plan through the Daraja sandbox | **Pass** | A real STK prompt reached the phone (+254 7•• ••• 670) and was approved. The callback came from `196.201.212.69` at 09:06:35. Payment `a1e60732-…` is `confirmed` with receipt `UK5DJ0XOIV`, KES 1, and invoice `VPK0000012` is paid. Subscription `c594f7e6-…` is `active` from 5 Nov 09:06 to 5 Dec 09:06, with grace to 8 Dec 09:06. |
| 3 | …creates a listing with photos and submits it | **Pass** | Listing `adbb0299-136f-403a-a22e-80364c718b1d` (`exit-run-test-2-bedroom-apartment-lavington-85e9e6`) has 2 photos and is `pending_review`. Its public URL shows "Listing not found" while in review (see finding F1). |
| 4 | An admin approves it | **Pass** | Approved by the platform owner's admin account at 09:43:16 (moderation log `approve`). The listing is now `published`, with `reviewed_by` set. The throwaway admin role was never granted: the session's permission check blocked it, so the owner approved instead. |
| 5 | It appears in search | **Pass** | Explore, Rent, `q=Lavington`: on page 1. The detail page renders the listing. |
| 6 | A buyer saves it and sends an inquiry the agent can see | **Pass** | `buyer+exit1105@example.test` saved it at 09:45:39 and it shows in Saved. Inquiry `2713d995-…` was sent at 09:47:50 to the owner. The agent's Inquiries page shows it as unread, with the buyer's phone and email. |
| 7 | A duplicate callback does not double-extend the plan | **Pass** | The stored callback was re-POSTed to the live callback URL at 09:07:47 and got HTTP 200 `Accepted`. It was recorded as an `stk_callback` event. The period end stayed 5 Dec 09:06:39, and the subscription still has exactly 1 invoice, which is paid. |
| 8 | When the plan lapses, the listing is paused after grace and returns on renewal | **Pass** | Ran on a temporary child branch of dev (`s11-exit-lapse`, `br-lingering-cloud-b9tuy0x4`), created at 09:49 and deleted after the check. See "Forced lapse and renewal" below. |
| 9 | Unpublished and paused listings are never public | **Pass** | 32 pages checked: home; Buy, Rent and Land × Recommended, Newest and Price × pages 1–3; and the detail pages whose "similar listings" would match each hidden listing. None shows the sample draft, pending or rejected listing, or the walkthrough listing in review. Their detail URLs show "Listing not found". The existing `public-listings` integration tests (paused included) pass. |

## Forced lapse and renewal (temporary branch)

1. `JOBS_FAKE_CLOCK_CONFIRM=yes npm run jobs:run -- grace-expiry --now 2026-12-08T10:06:39Z` ran
   against the branch only. That time is the grace end plus one hour.
   - The job reported 13 candidates, 11 listing plans paused, 2 verification plans paused and 18
     listings paused. These are the samples, the owner's own accounts and the walkthrough lister,
     all on the copy.
2. The walkthrough listing became `paused` with `pause_reason = plan_lapsed`. Checked with the
   app's own query functions: it was missing from `searchListings`, from `getPublicListing` (the
   detail page) and from the buyer's `savedListings`.
3. **The same check on dev at the same time:** still `published`, in search, on the detail page
   and in Saved. Dev was never touched by the fake clock.
4. **Renewal** on the branch: `mpesa:pay` plus `mpesa:simulate`, with a server pointed at the
   branch in simulator mode.
   - The payment reused the open invoice `VPK0000013`, whose earlier KES 5 payment was flagged.
   - It confirmed with receipt `SIMW9JWT5X`, and the subscription is `active` again.
   - The `status_change` event records `restoredListings: 1`.
   - The listing is `published` again and back in search, on its detail page and in Saved.
   - *Artefact:* only the job used the fake clock, so the renewal started a fresh 30-day period
     from the real confirmation time. In real use a pause only happens after the period has ended.
5. The branch was deleted. The project now has only `dev`, `test` and `production`.

## Clean-up

- The walkthrough listing was withdrawn by the agent at the end. It is out of search, the detail
  page and Saved.
- The admin moderated it, so the moderation log keeps it. That's why it is withdrawn rather than
  deleted.
- No admin role was granted, so there was none to revoke.
- These walkthrough accounts stay on dev as evidence, and none can act as an admin:
  - `agent+exit1105@example.test`
  - `admin+exit1105@example.test` (buyer role only)
  - `buyer+exit1105@example.test`
- Dev after the run, compared with before:
  - **Users:** 16 non-sample (+3 walkthrough accounts), plus the 4 sample users.
  - **Listings:** 26 non-sample (+1, the withdrawn walkthrough listing).
  - **Subscriptions:** 7 active listing subscriptions (+1).
  - **Payments:** 13 (+1 real sandbox, +1 flagged simulator, +6 SAMPLE).
  - **Favourites and inquiries:** 4 and 3 (+1 each).

## Payment security checks

| Check | Result | Evidence |
|---|---|---|
| Real sandbox STK prompt, confirmed with STK Query | **Pass** | Events: `stk_push` → `stk_callback` (196.201.212.69) → `stk_query` (first attempt HTTP 429 from the sandbox, retried) → `stk_query` result 0 → three `status_change` events (payment, invoice, subscription). |
| Replayed callback changes nothing | **Pass** | See criterion 7. |
| Forged-IP callback refused | **Pass** (with the allowlist on) | Local server with `MPESA_CALLBACK_ALLOWED_IPS` set to the three Safaricom /24s. The request from `203.0.113.66` got **403**, a `callback_rejected` event (`ip_not_allowed`) was recorded at 09:25:11, and the period end didn't change. See finding F3 for the live sandbox. |
| Amount mismatch is flagged and activates nothing | **Pass** | Simulator payment on invoice `VPK0000013` (KES 1), callback reporting KES 5. The payment is `flagged` (`amount_mismatch`) with `paid_amount_kes` 5, the invoice stays `open` and the subscription period is unchanged. It waits for a billing admin, as designed. |

## Browser check

1280px and 390px (390px with touch emulation) on home, Explore (Rent), a detail page, Saved (buyer)
and the lister's dashboard and overview: **0px horizontal overflow and 0 console errors on all 12**.
The 390px Explore filter sheet opens and shows "Apply filters", both with the Popover API and with
it removed. Screenshots are in the session scratchpad (`shots/s11-*.png`).

Seeded samples, checked in the browser:
- Home shows sample listings.
- Explore Recommended lists the two verified samples first, marked "Profile verified". Wanjiru's
  4th rent listing drops behind the unverified ones because of the "at most 3 per lister in the
  first 20" rule, as designed.
- The detail page shows the badge.

## Sample data (`npm run db:seed`)

- **Listers:** 4, with ids `sample-*` and emails `@example.test`. None has credentials, a phone or
  a public email.
  - Wanjiru Kamau and Brian Otieno are verified, derived from real verification rows plus paid
    plans.
  - Peter Njoroge is an unverified agent; Grace Achieng is an owner on Starter.
- **Listings:** 15 published with 39 photos, plus a draft, a pending_review and a rejected listing
  titled "should never appear publicly".
- **Payments:** 6 `manual` payments with receipts `SAMPLE0001`–`SAMPLE0006`, confirmed through
  `confirmPayment`. Their plans run to 5 Dec 2026; re-run the seed after that to renew them.
- **Remove:** `$env:SEED_CONFIRM="ep-weathered-cloud-b9h4jvv4"; npm run db:seed -- --remove`.
  - Deleted: the listings (archived instead if an admin moderated them) and the photo and avatar
    objects.
  - Changed: subscriptions are cancelled and verified reviews expire.
  - Kept: users, invoices, payments and events stay; they have no public presence.
- **Dev before seeding:** 13 users, 25 non-sample listings (1 published, 24 archived), 6 active
  listing subscriptions, 5 payments, 3 favourites, 2 inquiries. These are the numbers to compare
  after a removal.

## Findings

Follow-up: `prompts/s11-exit-fixes.md`.

- **F1. Hidden listing URLs return HTTP 200, not 404. Accepted, not fixed.** Draft, pending,
  rejected and missing slugs all render the "Listing not found" page with `noindex`, and none of
  their content appears. Search engines treat it as a soft 404 and don't index it.
  - *Why it can't be fixed in the page:* Next (Cache Components) prerenders
    `/properties/[slug]` into an empty shell stored with status 200. Each request serves that
    status, then resumes the render (`x-nextjs-prerender: 1`, `x-nextjs-postponed: 1`).
  - Calling `notFound()` before any `<Suspense>`, with `instant = false`, was built and tested on
    5 Nov. It still returned 200, so it was reverted.
  - A `proxy.ts` existence check could give a real 404. It would cost an extra query on every
    detail page load and show the generic "Page not found" page, so it was declined.
- **F2. Photo uploads fail on the live site. Fixed 5 Nov.** The `private-uploads` bucket's CORS
  rule allowed `https://verified-properties-ke.vercel.app` (with hyphens), but the live site is
  `https://verifiedpropertieske.vercel.app`. A preflight from the live origin got **403**, so the
  browser's direct upload was blocked. Localhost was allowed, which is why local uploads worked.
  - *Fix:* both buckets now allow `https://verifiedpropertieske.vercel.app`, `http://localhost:3000`
    and `http://127.0.0.1:3000`. The hyphenated origin was dropped. Methods (PUT, GET, HEAD), the
    `content-type` header and the 3600s max age are unchanged.
  - *Evidence:* read back with `GetBucketCors`. A PUT preflight now gets 200 with the matching
    allow-origin from the live origin and from localhost on both buckets. The old hyphenated
    origin gets 403.
  - A real photo upload on the live site is still to be confirmed by the owner.
- **F3. The live sandbox doesn't enforce the callback IP allowlist. Fixed 5 Nov.** The replay from
  a non-Safaricom IP was accepted. This was by design: in sandbox the allowlist applies only when
  `MPESA_CALLBACK_ALLOWED_IPS` is set, and production defaults to the Safaricom ranges. The token
  and STK Query still protected it.
  - *Fix:* Vercel production now has `MPESA_CALLBACK_ALLOWED_IPS =
    196.201.212.0/24,196.201.213.0/24,196.201.214.0/24` (plain, production only). It applies from
    the deploy of the fix commit.
- **F4 (minor). The footer showed "Log in" and "Get started" to signed-in users. Fixed 5 Nov.**
  - *Fix:* `FooterAccount` reads the session behind `<Suspense>`, the same pattern as the header.
    Signed out, it shows Log in and Get started; signed in, it shows My account (`/account`).
  - *Evidence:* checked in Edge at 1280px and 390px, signed out and signed in. Every link has a
    44px hit area, with 0px horizontal overflow and 0 console errors.

## Known gaps

- Resend isn't set on the live site, so live sign-ups get no verification or reset emails.
- Paystack isn't configured, so card payments are hidden.
- Daraja production go-live hasn't been done: production credentials, a confirmed Safaricom IP
  list and a real-money check.

## Next steps for Phase 2

- **S11 follow-up fixes** (`prompts/s11-exit-fixes.md`): F2–F4 are done. Still to confirm: one
  real photo upload on the live site, and a forged callback getting 403 on the live site after
  deploy. F1 stays a soft 404 with `noindex`.
- **Before real users:**
  - move the live site from the `dev` branch to `production`, copying users, listings and photos
    (buckets are branch-scoped)
  - set up Resend
  - do the Daraja production go-live, with a confirmed Safaricom IP list and a real-money check
- **Phase 2 scope (plan v2.0):**
  - the verification workflow: document upload to the private bucket, the review queue, and the
    audit log the seed doesn't write
  - in-app conversations (the tables already exist)
  - Playwright end-to-end tests built from this walkthrough's scripts
- **Re-seed after 5 Dec 2026**, or the sample plans lapse and the samples pause like anyone's.
