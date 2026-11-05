# S11 — Seed and exit run

## Goal

Close Phase 1 with two deliverables:

1. **`npm run db:seed`**: a repeatable seed that fills the Neon **dev** branch (the branch the live
   site reads) with clearly labelled SAMPLE listers, listings, photos, plans and sandbox payments,
   and **`npm run db:seed -- --remove`**, which takes the sample data down again.
2. **The Phase 1 exit run**: a recorded walkthrough of every Phase 1 exit criterion on the dev
   branch, with the Daraja sandbox, a replayed callback and a forced lapse, written up in
   `docs/PHASE1_REPORT.md`.

Plan v2.0 §9: "Seed script with clearly labelled sample data, sample plans and sandbox payments."

> **Exit criteria:** an agent signs up, pays for a Starter plan through the Daraja sandbox, creates
> a listing with photos and submits it; an admin approves it; it appears in search; a buyer saves
> it and sends an inquiry the agent can see. A duplicate callback does not double-extend the plan.
> When the plan lapses, the listing is paused after grace and returns on renewal. Unpublished and
> paused listings are never public.

## References read

- `AGENTS.md` (§6 business rules, especially trust signals and the derived badge; §7 data
  conventions; §8 security; §9 commands: `npm run db:seed` is "SAMPLE-labelled dev data (never
  production)")
- `docs/implementation-plan-v2.md` §9 (Phase 1 engineering tasks and exit criteria), §14 (testing
  data: seeded data, Daraja sandbox, a dedicated Neon branch, no destructive tests on production)
- Build plan `~/.claude/plans/above-is-the-scope-immutable-torvalds.md` "S11 — Seed and exit run"
  and its "Verification" list (real STK prompt, replayed callback, forged-IP 403, flagged amount
  mismatch, 1280px and 390px browser check)
- Memory: the live site uses the Neon `dev` branch and Neon Object Storage; Resend, Paystack and
  live-site email aren't configured; local `.env` has the Daraja sandbox (shortcode 174379), with
  callbacks landing on the live site; QStash and `MPESA_*` are set in Vercel production

## Existing code inspected

- `src/db/schema.ts` (all tables), `drizzle/0001`, `drizzle/0002`:
  - `listing_moderation_log`, `verification_audit_log`, `payment_events` and `billing_audit_log`
    are append-only by trigger.
  - Plan terms and invoice terms are immutable.
  - The `verified_listers_now` view needs three things: a `verified` request with an unexpired
    review, an active or past_due verification subscription inside grace, and an active or
    past_due listing subscription inside grace.
- `scripts/seed-plans.ts` (sandbox plans: Starter 3, Pro 20, Agency 100, Verification; KES 1–3),
  `scripts/create-admin.ts`, `scripts/lib/mpesa-script.ts` (`openScriptContext`, `parseArgs`),
  `scripts/lib/job-script.ts`, `scripts/jobs-run.ts` and `src/lib/jobs/fake-clock.ts` (`--now`
  needs `JOBS_FAKE_CLOCK_CONFIRM=yes`)
- `src/db/queries/payments.ts`: `insertPendingSubscription`, `insertInvoice`,
  `insertManualPayment`, `getActivePlanByCode`, `lockLiveSubscription`
- `src/lib/mpesa/confirm.ts` `confirmPayment`. It writes the status-change `payment_events`, marks
  the invoice paid and sets the 30-day period and the 3-day grace.
- `src/lib/storage/*`:
  - `processImage` rejects anything under 800×600 and never enlarges.
  - `processAvatar` needs a shortest side of at least 200.
  - Photo key formats are in `keys.ts`. `getPublicStore()` is `s3` locally because `.env.local`
    has `STORAGE_*`.
- `src/db/queries/listing-photos.ts`, `lister-profiles.ts` (`avatarKey`), `roles.ts`
  (`grantRoles`), `public-listings.ts`, `ranking.ts`
- `src/lib/validation/listing.ts` (title 10–120, description 30–4000, alt text 5–200),
  `src/lib/kenya.ts` (counties, amenities, commercial subtypes)
- `src/lib/jobs/reconciliation.ts`. Manual payments confirmed through `confirmPayment` reconcile
  cleanly. They are counted under `manual` in the daily totals.
- Old build: `../propertyhub-phase1-final/propertyhub/scripts/seed.ts` and `public/sample/`. It
  has 13 photos at 636×636, 13 matching thumbs, and 4 agent portraits at 256×256.
- Dev branch today: 13 users, 25 listings (1 published), 6 subscriptions, 5 payments, 4 plans,
  0 verification requests.

## Decisions and assumptions

1. **Target: the Neon dev branch** (user's choice). The live site will show the sample listings,
   so everything must be labelled, and `--remove` must take it all down without touching real
   accounts.

2. **Production guard: type the target to confirm.** The script reads `DATABASE_URL_UNPOOLED`
   (falling back to `DATABASE_URL`) and finds the endpoint name (the host's first label, e.g.
   `ep-xxx-123456`).
   - It refuses when `NODE_ENV=production`.
   - It refuses unless `SEED_CONFIRM` equals that endpoint name exactly. A run without it prints
     the target host and the exact command to re-run.
   - The operator therefore always confirms the branch they are about to change. It won't happen
     by accident through an env file pointing at production.

3. **Labelling.** Every sample item says it is a sample:
   - **User ids:** prefixed `sample-`. **Emails:** `<id>@example.test`, the reserved TLD, which
     can't receive mail.
   - **Display names:** end in "(sample)".
   - **Listing titles:** start with "Sample: ".
   - **Descriptions:** end with "SAMPLE DATA: this is not a real property listing."
   - **Photo alt text:** starts with "Sample photo:".
   - **Payments:** M-Pesa receipts look like `SAMPLE0001`, and `raw_callback` holds
     `{ "sample": true, "source": "db:seed" }`.

4. **Sample users can't sign in.** There are no `accounts` rows and no passwords, so nobody can
   sign in to the live site as a sample lister. The exit run uses fresh, real sign-ups.

5. **No contact details on sample listers.** `phone` and `public_email` stay null, because any
   made-up 07xx number could belong to a real person, and verified listers' phones are public. The
   contact panel then shows its normal "no phone" path.

6. **Four sample listers, 15 public listings, 3 hidden ones.**

   | id | Name | Type | Listing plan | Verified | Listings |
   |---|---|---|---|---|---|
   | `sample-agent-wanjiru` | Wanjiru Kamau (sample) | agent | Pro | yes | 6 published |
   | `sample-agent-otieno` | Brian Otieno (sample) | agent | Pro | yes | 4 published |
   | `sample-agent-njoroge` | Peter Njoroge (sample) | agent | Pro | no | 3 published, 1 draft |
   | `sample-owner-achieng` | Grace Achieng (sample) | owner | Starter (limit 3) | no | 2 published, 1 pending_review, 1 rejected |

   - **Listing mix:** rent and sale; house, apartment, land and commercial; Nairobi, Kiambu,
     Kajiado, Mombasa, Nakuru and Machakos. Adapted from the old seed's 15 listings, with
     amenities and subtypes only from `kenya.ts`.
   - **Limits:** no lister goes over their plan limit. Achieng's 2 published fit Starter's 3, and
     pending_review doesn't count.
   - **Hidden listings:** the draft, the pending_review and the rejected listing have titles that
     say "should never appear publicly". They are the never-public checks.
   - **Pause check:** there is no seeded paused listing. The exit run produces a real one with the
     fake-clock job.
   - **Location:** public points are approximate (neighbourhood centre). `exact_*` stays null and
     `show_exact_location` false.
   - **Publish dates:** `published_at` is spread over the last 1–15 days. `reviewed_at` is set on
     unverified listers' published listings (`reviewed_by` null). No moderation-log rows are
     written, so `--remove` can delete the listings.

7. **"Verified" is derived from real rows, never stored as a flag** (user's choice: 2 sample
   verified listers). For Wanjiru and Otieno the seed inserts a `verification_requests` row with:
   - `status = 'verified'`
   - `decided_at = now`
   - `review_expires_at = now + 12 months`
   - `decision_reason = 'SAMPLE: seeded for demonstration'`

   Each also gets an active verification subscription paid through the sandbox flow (decision 8).
   The badge and the verified tier come from `verified_listers_now` like for anyone else. No
   `verification_audit_log` rows are written, because they are append-only and would block
   `--remove`.

8. **Sandbox payments go through the real confirmation code.** For each sample subscription
   (listing plan, plus verification for the two verified listers) the seed runs these steps in
   one transaction:
   1. `insertPendingSubscription`
   2. `insertInvoice` (amount from `plans`)
   3. `insertManualPayment` (receipt `SAMPLE####`, phone null)
   4. `confirmPayment`

   That gives an active subscription with a 30-day period and 3-day grace, a paid invoice and the
   normal `payment_events`, all reconciling cleanly. The 30-day period means sample listings lapse
   about 33 days after seeding unless re-seeded. That is fine: they then pause like anyone's would.

9. **Plans.** The `SANDBOX_PLANS` list moves from `scripts/seed-plans.ts` into
   `scripts/lib/sandbox-plans.ts`. Both scripts use it. The seed inserts plans only where no
   active version of that code exists, and never edits plans.

10. **Photos.**
    - **Copy:** the 13 full-size sample photos and the 4 portraits from the old build go into
      `scripts/seed-assets/` (about 1 MB, committed). Thumbs are skipped.
    - **Upscale:** the photos are 636×636, below the 800×600 minimum. The seed upscales each one in
      memory with sharp to 1200×1200 before it calls the real `processImage`. Variants and keys
      then match uploaded photos exactly.
    - **Store:** photos go to `getPublicStore()` (the dev branch's `listing-photos` bucket) under
      `newImageBaseKey`, with `property_images` rows (cover first, sort order, alt text).
    - **Avatars:** go through `processAvatar` and `newAvatarBaseKey`.
    - **No storage:** if storage mode is `none`, the seed refuses before writing anything.

11. **Idempotent seeding.** Re-running fills in whatever is missing and changes nothing else:
    - **Users and profiles:** upsert by id.
    - **Roles:** granted with `grantRoles`.
    - **Subscriptions:** created and paid only when the user has no live one of that kind.
    - **Verification:** a request is inserted only when none is verified and unexpired.
    - **Listings:** inserted by fixed slug (`sample-...`) with conflict-do-nothing. Photos are added
      only to listings inserted in this run.

    The script prints a table of inserted versus already existing. Re-running after `--remove`
    re-creates everything.

12. **`--remove` takes down sample data only.** It only touches users whose id starts with
    `sample-` and whose email ends with `@example.test`. Append-only and immutable tables keep
    their rows by design:
    - **Listings:** deletes their properties. Images, favourites, inquiries and reports cascade.
    - **Moderated listings:** if a real admin moderated a sample listing (a moderation-log row
      exists), that listing is set to `archived` instead of deleted.
    - **Photos:** deletes the photo and avatar objects from storage.
    - **Subscriptions:** sets live sample subscriptions to `cancelled` (`cancelled_at = now`).
    - **Verification:** sets sample verification requests to `expired`.
    - **Kept:** sample users, profiles, invoices, payments and events stay, but have no public
      presence and can't sign in.
    - **Report:** prints what it changed.

13. **Where the code lives.**
    - **Script:** `scripts/seed.ts` is a thin script (guard, context, flags, output).
    - **Data:** `src/db/seed/sample-data.ts` holds the typed sample data.
    - **Logic:** `src/db/seed/seed.ts` has `seedSampleData(deps)` and `removeSampleData(deps)`.
      `deps` is `{ db, withTransaction, publicStore, now, readAsset }`.
    - **Why `src/`:** Vitest only collects `src/**/*.test.ts`. The script runs with
      `--conditions=react-server` like the other scripts.

14. **Exit-run accounts.** The run uses fresh accounts with `+exit` aliases on `@example.test`.
    - **Email links:** in local dev the email transport logs verification links to the dev server
      terminal.
    - **Admin:** the run grants `platform_admin` to its own throwaway admin account with
      `ADMIN_CREATE_CONFIRM=yes npm run admin:create`, and deletes that `user_roles` row at the end.
    - **Kept:** the walkthrough accounts and their listings stay on dev as evidence. The run
      withdraws the walkthrough listing at the end, and the report lists every id.

15. **Daraja sandbox step needs you.** The STK prompt goes to the phone number you give me, and you
    approve it on the phone. The callback lands on the live site, which shares the dev database.
    - **If the sandbox prompt doesn't arrive:** the report records that, and the same flow is
      completed with the simulator (`mpesa:pay` / `mpesa:simulate`). The real-prompt check is then
      marked "owed", not passed.
    - **Steps I can run myself:** the replayed callback, the forged-IP 403, the amount mismatch
      and the fake-clock lapse.

16. **The forced lapse runs on a throwaway copy of dev, not on dev itself.**
    - **Why:** `grace-expiry` with a fake clock pauses every subscription whose grace has ended by
      the fake time. On dev that would include your own accounts' subscriptions (6 today) and the
      sample ones, which all end about 30 days out, just like the walkthrough lister's.
    - **How:** right after step 7, I create a Neon child branch of dev (`s11-exit-lapse`) that
      contains the walkthrough data. Steps 8 and 9 run there through the scripts and query checks.
      I delete the branch when they're done.
    - **What stays the same:** dev and the live site are never touched by the fake clock.
    - **Approval:** approving this prompt approves creating and deleting that one branch.
    - **Photos:** buckets are branch-scoped, so the paused listing's photos aren't checked on the
      branch. The status and visibility are what's being tested.

17. **Out of scope:**
    - new UI
    - Playwright as a project dependency (the run uses `playwright-core` with Edge from the
      scratchpad, per memory)
    - fixing things the exit run finds

    Failures go in the report with a suggested fix and are raised with you before any code
    changes.

## Files likely to change

- `package.json`: `db:seed` script
  (`node --env-file-if-exists=.env --env-file-if-exists=.env.local --conditions=react-server --import tsx scripts/seed.ts`)
- `scripts/seed.ts` (new), `scripts/lib/sandbox-plans.ts` (new), `scripts/seed-plans.ts` (use
  the shared list)
- `scripts/seed-assets/*.webp` (new, 17 files copied from the old build)
- `src/db/seed/sample-data.ts`, `src/db/seed/seed.ts` (new)
- `src/db/seed/sample-data.test.ts`, `src/db/seed/seed.integration.test.ts` (new)
- `.env.example`: document `SEED_CONFIRM` (placeholder, with an explanation)
- `docs/PHASE1_REPORT.md` (new, written during the exit run)
- `AGENTS.md` §9: `db:seed` arrives in S11, so drop "(arrives in S11)" and add the `--remove` and
  `SEED_CONFIRM` usage

## Implementation requirements

1. **`scripts/seed.ts`**
   - **Flags:** `--remove`, plus `--dry-run`, which prints the plan and target without writing.
   - **Guard:** decision 2. **Storage check:** decision 10.
   - **Output:** one summary table. Logs mask nothing sensitive because there's nothing sensitive
     to log: no emails beyond `@example.test`, no secrets.
   - **Exit codes:** 0 on success, 1 on refusal or error. On error it prints the error's message
     only.
2. **`seedSampleData`**
   - **Transaction:** each lister is seeded in one transaction (user, profile, roles,
     subscriptions, payments, verification, listings, photo rows).
   - **Photo order:** photo objects are uploaded before that transaction and deleted again if it
     fails, so no orphaned objects are left.
   - **Clock:** `now` comes from deps, so tests can fix it.
3. **`removeSampleData`**: decision 12. Each lister is handled in its own transaction, and storage
   deletes run after the commit.
4. **`sample-data.ts`**: plain typed objects. A unit test checks that every sample listing passes:
   - the same `listingSchema`/submit checks the app uses (title, description, price, rent period
     only on rent, land size has unit)
   - counties in `KENYA_COUNTIES`, amenities in `AMENITIES`, subtypes in `COMMERCIAL_SUBTYPES`
   - unique slugs that start with `sample-`
   - the labels from decision 3
   - photo alt text 5–200 characters
   - published count per lister at or under that lister's plan limit
5. **Integration test (test branch):**
   - **Seed:** seeding with an in-memory `ObjectStore` produces 15 published listings that
     `searchListings` returns.
   - **Hidden:** the 3 hidden listings never appear in search or in `homeShowcase`.
   - **Verified:** exactly Wanjiru and Otieno are in `verified_listers_now`.
   - **Payments:** every sample payment is `confirmed` with a paid invoice.
   - **Idempotent:** a second seed inserts nothing.
   - **Remove:** `--remove` leaves 0 public sample listings and 0 verified sample listers, and
     deletes their storage objects.
   - **Re-seed:** seeding again after removing restores everything.
   - **Fixtures:** the test uses its own id prefix, `sample-t-`, so it can't collide with other
     suites (memory gotcha).
6. **Exit run**, in this order. Every step records evidence (ids, timestamps, the
   `payment_events` rows, screenshots in the scratchpad):
   1. `npm run db:seed` on dev. Check that home, Explore and a detail page show the samples, with
      verified samples first under Recommended.
   2. Agent signs up and verifies their email from the logged link, then picks Starter and pays
      through the **Daraja sandbox** STK (decision 15). The subscription becomes active, with a
      period end 30 days out.
   3. **Replayed callback:** re-POST the stored raw callback to the callback URL. Expect
      `payment_events` to record it, the period end to stay unchanged and no second invoice to be
      paid.
   4. **Forged-IP callback** from this machine returns 403. **Amount mismatch** via the simulator
      (`--amount`) ends in a `flagged` payment that activates nothing.
   5. Agent creates a listing, adds photos and submits it, and it shows as `pending_review`. A
      direct visit to its URL returns 404 while it waits.
   6. The exit admin approves it. It appears in Explore search and on its detail page.
   7. Buyer signs up, saves the listing (it appears in Saved) and sends an inquiry. The agent sees
      the inquiry in their dashboard.
   8. **Forced lapse, on a temporary branch (decision 16):**
      `JOBS_FAKE_CLOCK_CONFIRM=yes npm run jobs:run -- grace-expiry --now <period end + 3 days + 1 hour>`.
      Run it with `DATABASE_URL`/`DATABASE_URL_UNPOOLED` pointing at the temporary branch. Expect
      the walkthrough listing to become `paused` with `pause_reason = plan_lapsed`, and to be
      missing from `searchListings`, the detail query and the public Saved card. These are checked
      with a small scratchpad script that calls the app's public query functions against that
      branch.
   9. **Renewal, same temporary branch:** pay again with the simulator (`mpesa:pay` +
      `mpesa:simulate`). `confirmPayment` restores the listing to `published` and the public
      queries return it again. Then delete the temporary branch.
   10. **Never public (on dev):** sample draft, pending and rejected listings are absent from
       search, home, similar listings and detail pages (404). The paused case is covered by
       step 8, plus a check that the existing `public-listings` integration tests still pass.
   11. **Browser check** at 1280px and 390px on home, Explore, detail, Saved and the lister
       dashboard: no horizontal overflow and no console errors. Repeat the 390px Explore filter
       sheet with the Popover API removed (memory).
   12. **Clean up:** withdraw the walkthrough listing and delete the exit admin's role row.
   13. **Report:** write `docs/PHASE1_REPORT.md`:
       - a table of each exit criterion with pass, fail or owed and its evidence
       - payment security checks
       - what the seed contains and how to remove it
       - known gaps: Resend not set on the live site, Paystack not configured, the Daraja
         production go-live still to do, and any issues found
       - next steps for Phase 2

## Security requirements

- The seed can't run on production by accident: it refuses on `NODE_ENV=production`, and the
  endpoint name must be typed to confirm (decision 2). `--remove` has the same guard.
- Sample users have no credentials, no real contact details, and the `@example.test` domain only.
- Verification and payments come from real rows read by the existing derived view and
  confirmation code. Nothing writes a badge or a status flag directly, and no app code path
  changes.
- `--remove` selects by id prefix **and** email domain, so a real account can never match.
- The exit run's replay and forged-IP checks only target our own callback endpoint. Secrets stay
  in env files and are never printed. Phone numbers are masked in the report.
- The throwaway admin role is removed at the end of the run.
- The fake clock never runs against dev or production, only against the temporary child branch
  (decision 16). That branch is deleted afterwards.

## Acceptance criteria

- **Refusals:** `npm run db:seed` without `SEED_CONFIRM` changes nothing, prints the target
  endpoint and the exact command, and exits 1. With the wrong value it also refuses.
- **Seeded state:** a confirmed run on dev gives these results:
  - 4 sample listers and 15 public sample listings with photos, plus 3 hidden ones
  - 2 sample listers shown as "Profile verified" and ranked first under Recommended
  - every sample payment `confirmed`
  - the reconciliation job reports no issues for sample data
- **Idempotent:** re-running inserts nothing new. Re-running after `--remove` restores everything.
- **Remove:** `--remove` leaves no sample listing public and no sample lister verified, deletes the
  sample photo objects, and leaves real users' data untouched. The dev row counts for non-sample
  users are the same before and after.
- **Tests:** unit and integration tests pass.
- **Exit run:** `docs/PHASE1_REPORT.md` shows each Phase 1 exit criterion as passed, or as clearly
  marked "owed" with the reason and the fallback evidence.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (test branch)
- `npm run build`, because `scripts/` and `src/db` changed and the build checks nothing imports
  the seed into the app

## Manual test steps (after implementation)

1. **Dry run:** `npm run db:seed -- --dry-run`. It prints the target endpoint and what would be
   inserted.
2. **Seed:** PowerShell: `$env:SEED_CONFIRM="<endpoint printed above>"; npm run db:seed`. Check
   the table: plans, 4 listers, 18 listings, photos and payments inserted.
3. **Look at the result:** open http://localhost:3000 (and the live site). Check:
   - the home page shows sample listings with photos, all titled "Sample: …"
   - the two "(sample)" verified agents carry the badge and come first in Explore under
     Recommended
   - the "should never appear publicly" listings are nowhere
4. **Re-run** step 2: everything reports "already existed".
5. **Admin view:** open `/admin/billing` as your admin. Sample payments show `SAMPLE` receipts and
   none are flagged.
6. **Remove:** `$env:SEED_CONFIRM="<endpoint>"; npm run db:seed -- --remove`. The sample listings
   are gone from the site and your own listings are unchanged. Re-seed if you want the samples
   back.
7. **Exit report:** read `docs/PHASE1_REPORT.md`. For the Daraja sandbox step I'll ask you for a
   phone number and to approve the prompt when it arrives.
