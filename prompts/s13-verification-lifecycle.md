# S13 — Verification lifecycle: expiry, re-review, reminders, retention, dashboard stats

Second slice of Phase 2 (plan v2.0 §10). It follows S12, which covered paying, uploading,
reviewing and the badge.

## Goal

After S12 a lister can get verified. S13 covers what happens over the following year:

- **Expiry.** When a review passes its 12 months, a job marks it `expired` and writes audit
  `expire`. The badge already drops at that moment, because `verified_listers_now` reads
  `review_expires_at`. The job adds the state change, the audit row and the email.
- **Re-review reminders.** These go out 30 and 7 days before a review expires (plan §10), by
  email, and by SMS when SMS is configured.
- **Re-review (your choice: included in the monthly fee).** A lister whose verification and
  listing plans are both in good standing can start a re-review from 30 days before expiry, at no
  extra charge. They upload fresh documents and keep their current badge until the old review
  ends. Approval replaces the old review.
- **Verification-plan renewal reminders.** These are the 5-day and 1-day reminders before the
  verification subscription ends. S9 left them for Phase 2.
- **Document retention (your choice: balanced).** Verification files are securely deleted on a
  schedule:
  - approved reviews: 90 days after the review ends (expired or replaced);
  - rejected reviews: 90 days after the decision;
  - suspended reviews: 24 months after the suspension.

  The request rows and the audit log stay. These periods are a draft for a lawyer to confirm
  before launch (Kenya DPA 2019 sets no fixed period).
- **Lister dashboard stats.** The overview gets the design-01 stat cards (enquiries, property
  views, verification) and a "Since you were verified" comparison (plan §5 "Measuring it", §10).
  Property views are counted for the first time in this slice.

Phase 2 exit criterion covered here: "lapsed payment or an expired review removes the badge
automatically". Home featured sections are S14, messaging S15, and Resend live, delivery records
and the failed-jobs view S16.

## References read

- `AGENTS.md`
- `docs/implementation-plan-v2.md`:
  - §4: billing rules (5-day and 1-day reminders), the lapse table, paid verification rules
    (12-month review, monthly payment keeps the badge visible)
  - §5: measuring it (views, saves and inquiries; show verified listers their own numbers)
  - §6: derived badge
  - §10: 30-day and 7-day re-review reminders, an expired review removes the badge, retention and
    secure deletion under the Kenya DPA, dashboard stats, audit actions including `expire`
- `prompts/s12-verification.md` (slice plan, statuses, decisions 2, 5, 9 and 11)
- `prompts/s9-jobs.md` (job runner, signature, reminder claim and finish, `jobs:run`, schedules)
- Design `3 - Lister & Admin Dashboards/01 — Lister Dashboard` (four stat cards; a Views column
  in the listings table) and `02 — Billing & Verification` (verification card)
- `prompts/ui-compact-design-system.md`, `prompts/ui-mobile-optimization.md`

## Existing code inspected

- **Badge view.** `drizzle/0002_billing.sql` defines `verified_listers_now`. It needs a
  `verified` request with `review_expires_at > now()`, plus verification and listing
  subscriptions that are `active`/`past_due` with `grace_ends_at > now()`. So expiry needs no
  write for correctness, and nothing in this slice changes the view.
- **Rules.** `src/lib/verification/rules.ts`:
  - `canTransition` allows `verified → expired`, which nothing uses yet;
  - `OPEN_STATUSES`, `reviewExpiresAt` (12 months), `AUDIT_ACTIONS`/`AUDIT_LABELS`.
  - The partial unique index `verification_requests_one_open_idx` allows one open request
    *alongside* a verified one, so a re-review fits without schema gymnastics.
- **Purchase.** `src/lib/verification/purchase.ts`:
  - `attachVerificationInvoice` and `onVerificationPaid` treat a payment as a renewal when an
    unexpired approved review exists;
  - `checkVerificationPurchase` refuses suspended listers and in-progress requests.
- **Decisions.** `src/lib/verification/decisions.ts`:
  - `decide()` locks the request and checks the expected status;
  - `rejectRequest` credits the fee from `request.invoiceId` (it writes `credit_skipped` when
    there is no payment) and calls `endVerificationBilling`;
  - `suspendRequest` sets `decided_at` and ends billing.
- **Lister view.** `src/lib/verification/view.ts` (`listerView`, `viewBadge`) and `load.ts`
  (`loadListerVerification`).
- **Queries.** `src/db/queries/verification.ts`: `getLatestRequest`, `getOpenRequest`,
  `getUnexpiredVerifiedRequest`, `insertRequest`, `updateRequest`, `insertAudit`,
  `listDocuments`, `referencedDocumentKeys`, `getRequestForReview`.
- **Jobs.** `src/lib/jobs/*`:
  - `registry.ts`, `types.ts` (`JOB_NAMES`), `schedules.ts`, `counter.ts`;
  - `renewal-reminders.ts` + `reminder-window.ts` (claim, then send, then finish, through
    `billing_reminders`);
  - `db/queries/jobs.ts#reminderCandidates`, which filters `kind = 'listing'` (the gap S9
    deferred), and `db/queries/reminders.ts`;
  - `grace-expiry.ts`, which already pauses verification subscriptions.
- **Storage.** `src/lib/storage/cleanup.ts`. S12 made it delete `verification/` objects older
  than 24h that no document row references, which is the safety net for a failed purge.
- **Email.** `src/lib/email/templates.ts` (`verificationDecisionEmail`, `renewalReminderEmail`,
  `renewalReminderSms`, `layout`) and `send.ts` (dev console transport, `maskEmail`).
- **Dashboard.** `src/app/account/page.tsx`:
  - only the Active listings card exists;
  - the profile card's badge is hard-coded `<Badge>Not verified</Badge>`, which is now wrong for
    verified listers.
- **Engagement data.** `favorites` (`created_at`, row deleted on unsave) and `inquiries`
  (`created_at`, `recipient_user_id`) exist. There is **no view tracking** anywhere.
- **Detail page and rate limits.**
  - `src/app/properties/[slug]/page.tsx`: the detail page (Suspense, `ownerUserId` known).
  - `src/lib/rate-limit.ts`: `POLICIES`, `rateLimitKey`, `checkRateLimits`, Upstash in prod and
    memory in dev.
  - `src/lib/mpesa/callback-guard.ts#requestIp`: the client IP from `x-real-ip` /
    `x-forwarded-for`.

## Decisions

1. **Migration `0007_verification_lifecycle`.**
   - `verification_requests.renews_request_id uuid null`, a foreign key to
     `verification_requests(id)`. It is set on a re-review and points at the approved request it
     will replace.
   - `verification_requests.ended_at timestamptz null`. It is set when a verified review stops
     counting, by expiry or by replacement. Retention measures from it.
   - `verification_requests.documents_purged_at timestamptz null`.
   - The audit action check gains `rereview`, `expire`, `supersede` and `purge_documents`.
   - New table `verification_reminders`, the same shape as `billing_reminders`:
     - columns `request_id`, `reminder` (`30d` | `7d` | `expired`), `channel` (`email` | `sms`),
       `status`, `attempts`, `last_error`, `sent_at`;
     - unique `(request_id, reminder, channel)`;
     - the same checks as `billing_reminders`.
   - New table `listing_view_days`:
     - columns `property_id` (foreign key, cascade), `day date` (Nairobi calendar day),
       `views integer >= 0`;
     - primary key `(property_id, day)`.

     It holds daily counters only: no IPs, users or user agents.
   - `drizzle-kit generate`; a hand-written SQL step if drizzle can't express a check.
2. **Transitions** (`rules.ts`; every edge unit tested):
   - existing: `verified → expired` is now used by the expiry job and by replacement;
   - new: `documents_pending → rejected`, used **only** by the system when a suspension closes an
     open re-review (decision 6). The admin UI never offers Reject on `documents_pending`.
3. **Re-review eligibility** is computed in one place: `canStartRereview(facts, now)`, a pure
   function in `rules.ts` that returns a typed refusal. It needs all of:
   - **an approved review to renew.** This is the lister's most recent request with status
     `verified` or `expired`. Its `review_expires_at` is at most 30 days away, or already past.
   - **no open request.**
   - **the latest request is not `suspended`.**
   - **a verification subscription in good standing** (active or grace phase), and the same for
     the listing plan.

   When the subscriptions aren't in good standing, the page sends the lister to the normal paid
   checkout instead. That path is unchanged from S12: a payment with no unexpired review opens a
   request.
4. **Starting a re-review** (`startRereviewAction`, rate limit `verificationSubmitPerUser`). In
   one transaction it:
   - locks and re-checks eligibility;
   - inserts a request directly in `documents_pending` with `invoice_id = null` and
     `renews_request_id` set;
   - writes audit `rereview`.

   Upload and submit then work exactly as in S12, including the required types from the
   lister's current profile. The old review keeps the badge until its own expiry.
5. **Approving** (any request, first-time or re-review). In the same transaction, every *other*
   `verified` request of that lister becomes `expired`, with `ended_at = now` and audit
   `supersede` ("Replaced by VR-xxxxxx"). The new review runs 12 months from the decision (the
   S12 rule). The expiry job and the reminders therefore never act on a replaced review.
6. **Re-review rejection and suspension.**
   - **Rejecting a re-review** (`renews_request_id` set) gives **no credit** and writes no
     `credit` or `credit_skipped` row, because nothing was paid for it. It also does **not**
     cancel the verification subscription. The current review keeps the badge until it expires,
     and the lister may start another re-review. The rejection email says this.
   - **First-time rejection** keeps the S12 behaviour.
   - **Suspending** keeps the S12 behaviour (suspend the verified request, end billing). It also
     closes any open re-review of the same lister as `rejected`, with the reason "Closed because
     verification was suspended" and audit `reject` (actor = the admin).
7. **New job `verification-lifecycle`**, daily at 07:05 Nairobi (`5 4 * * *`). It is added to
   `JOB_NAMES`, the registry and `JOB_SCHEDULES`, so it can also be run with `jobs:run`. It has
   three independent steps, each with its own counts; a failure in one item never stops the
   others:
   1. **Expire.** `verified` requests with `review_expires_at <= now`, oldest first, batch 100.
      Each one is locked and re-checked, then set to `expired` with `ended_at = review_expires_at`
      and audit `expire` (actor null, reason "12-month review ended"). After commit, the lister
      gets an `expired` email, claimed through `verification_reminders` so it is sent at most
      once.
   2. **Remind.** `verified` requests whose review ends within `(now, now + 30d]`. Requests are
      skipped when the lister has an open request (a re-review is under way) or when that
      window's reminder is already finished.
      - The window: `30d` while more than 7 days are left, `7d` inside the last 7 days. A missed
        30-day window sends only the 7-day reminder, never both (the pure
        `rereviewReminderDue`, mirroring `reminderDue`).
      - Channels: email, plus SMS to the lister profile phone when SMS is configured. Claim, send
        and finish work as in `renewal-reminders`.
   3. **Purge documents (retention).** Requests with documents still present
      (`documents_purged_at is null`) and a retention clock that has run out, batch 50:
      - `expired`: `ended_at + 90 days`
      - `rejected`: `decided_at + 90 days`
      - `suspended`: `decided_at + 24 months`

      Open and currently `verified` requests are never purged. The policy constants live in one
      place, `lib/verification/retention.ts`, which is pure and unit tested. Each request is
      purged in one transaction: lock and re-check, delete its `verification_documents` rows, set
      `documents_purged_at`, write audit `purge_documents` with the file count. After commit the
      objects are deleted from the **private** store. A failed object delete is only logged,
      because the nightly `storage-cleanup` sweep removes unreferenced `verification/` objects
      after 24h.

   The summary holds counts and ids only.
8. **Verification-plan renewal reminders.** `reminderCandidates` also returns `verification`
   subscriptions, with the same 5d/1d windows and the `billing_reminders` dedupe. The candidate
   carries `planKind`, and the templates pick their wording from it:
   - verification: "Your verification plan ends on …; renew to keep your Profile verified badge".
     The Renew link goes to `/account/billing/checkout?plan=<code>`.
   - listing: wording unchanged.

   Recipients are the subscription owner (verification subscriptions are per user).
   Cancelled subscriptions are already excluded by the status filter.
9. **Emails and SMS** (dev prints them; live once Resend is set in S16). They carry minimal data
   (first name, a date, a link to `/account/verification`) and are sent after commit; a failed
   send never rolls back a state change.
   - email `rereview_due` (30d / 7d), and SMS `rereview_due`;
   - email `expired`;
   - email `rejected` gains the re-review variant;
   - `renewalReminderEmail`/`Sms` gain the verification wording.
10. **Lister verification page** (`listerView` / `viewBadge` extended; pure, unit tested):
    - **Verified, more than 30 days left:** unchanged.
    - **Verified, 30 days or fewer left:** adds "Your review ends on {date}. Start your re-review
      now; it's included in your plan." with a **Start re-review** button, when eligible.
    - **Upload / Under review with `renews_request_id`:** adds "Your current badge stays until
      {date}."
    - **Rejected re-review:** the reason, "Your current review stays valid until {date}" (or
      "has ended"), and **Start re-review** when eligible.
    - **Expired** (status `expired`, or a lapsed `verified`):
      - "Your review ended on {date}." Then **Start re-review** (included) when the plans are in
        good standing, otherwise **Renew verification** to checkout.
      - Today this state shows as "not started, reapply"; it gets its own wording.
    - **Retention notice**, under the upload area, in `micro`: "We delete your documents 90 days
      after your review ends or is declined (24 months if verification is suspended)."
    - The billing page's `VerificationCard` uses the same view, so it updates for free.
11. **Admin.**
    - The review detail shows "Re-review of VR-xxxxxx" when `renews_request_id` is set.
    - When `documents_purged_at` is set, the documents block reads "Documents deleted on {date}
      under the retention policy" and has no View links. The document route returns 404 for
      deleted documents (the row is gone).
    - The audit trail shows the new actions through `AUDIT_LABELS`.
    - The queue's Verified tab gains an "Expired" tab (read-only), so the list stays complete.
12. **Counting property views.**
    - A small client component `ListingViewBeacon` on the detail page calls the server action
      `recordListingViewAction(propertyId)` once after mount. Prefetches, server renders and most
      bots never run it.
    - The action:
      1. validates a uuid with Zod;
      2. skips the count when the signed-in user owns the listing;
      3. dedupes with a new rate-limit policy `listingViewPerVisitor` (1 per 30 minutes, keyed on
         a SHA-256 of IP and listing id, or user id and listing id when signed in). Over the
         limit, or the limiter unavailable, means "don't count". It never errors.
      4. upserts `listing_view_days (property_id, today in Nairobi) views + 1`, only when the
         listing is `published` (`INSERT … SELECT … WHERE status = 'published' ON CONFLICT DO
         UPDATE`).
    - It returns nothing useful to the browser.
    - Views are a lister-facing number only. **They never feed ranking**, so inflating them gains
      nothing; the prompt notes this in code.
    - The tracking start is a constant, `LISTING_VIEWS_SINCE` (the deploy date). Comparisons
      before it show "Not tracked yet" instead of zero.
13. **Dashboard stats** (`/account`, listers only; queries scoped to listings with
    `owner_user_id = session user`, in a new `db/queries/lister-stats.ts`):
    - **Stat cards** (design 01, the existing overview grid `sm:2 xl:4`):
      - **Active listings:** unchanged.
      - **Enquiries:** count of inquiries received in the last 30 days, then "+12% vs previous 30
        days", "−5% …" or "None in the previous 30 days".
      - **Property views:** the same 30-day count and comparison, from `listing_view_days`.
      - **Verification:** the `viewBadge` label as the headline, and one line: "In good standing",
        "Review ends {date}", "Re-review due by {date}", "Renew to restore the badge", and so on.
        It links to `/account/verification`.
    - **Change colours:** `emerald-700` for up and `slate-600` for down or flat. The sign and the
      words carry the meaning.
    - **Profile card:** the hard-coded "Not verified" badge becomes the derived badge
      (`lister_verified_now` and `viewBadge`).
    - **"Since you were verified" panel.** It is shown when the lister has an approved review
      (current or expired) and at least 7 days have passed since their **first** approval.
      - Rows: Views, Saves and Enquiries, each as a per-day average before and after, with the
        change.
      - Before: the 30 days up to the first approval. After: the last 30 days, or since approval
        when that is shorter.
      - Views before `LISTING_VIEWS_SINCE` read "Not tracked yet".
      - A `micro` note says saves count homes still saved (unsaving removes them).
      - Under 7 days, the panel reads "Your comparison appears 7 days after approval."
    - **My listings** (`/account/listings`): each row gains "Views (30 days)", matching the
      design's Views column.
    - Agency members see their own listings' numbers. Agency-wide totals are not in this slice.
14. **Seed.** No new SAMPLE data, except `listing_view_days` rows for SAMPLE listings (a random
    0–40 per day for the last 60 days), so the dashboard isn't empty on dev. The S11 guards
    apply: never production.

## Files likely to change

```text
src/db/schema.ts                                   new columns, two tables, audit check
drizzle/0007_verification_lifecycle.sql (+ meta)   generated (+ hand-written check if needed)
src/lib/verification/rules.ts                      transitions, canStartRereview, actions/labels
src/lib/verification/retention.ts                  new: retention policy (pure)
src/lib/verification/reminder-window.ts            new: rereviewReminderDue (pure)
src/lib/verification/view.ts, load.ts              new states and fields
src/lib/verification/decisions.ts                  supersede on approve; re-review reject; suspend closes re-review
src/lib/verification/rereview.ts                   new: startRereview (transaction)
src/lib/verification/lifecycle.ts                  new: expire / remind / purge steps
src/db/queries/verification.ts                     lifecycle candidates, last approved, reminders, purge
src/db/queries/jobs.ts                             reminderCandidates includes verification kind
src/db/queries/lister-stats.ts                     new: 30-day counts, before/after, per-listing views
src/db/queries/listing-views.ts                    new: upsert daily counter
src/lib/jobs/{types,registry,schedules}.ts, verification-lifecycle.ts, renewal-reminders.ts
src/lib/email/templates.ts                         rereview_due, expired, re-review rejection, verification renewal wording
src/lib/rate-limit.ts                              listingViewPerVisitor policy
src/app/account/verification/{page.tsx,actions.ts} Start re-review, new states, retention notice
src/app/account/page.tsx                           stat cards, derived badge, comparison panel
src/app/account/listings/page.tsx                  Views (30 days)
src/app/properties/[slug]/page.tsx, actions.ts     ListingViewBeacon + recordListingViewAction
src/app/admin/verification/*                       re-review label, purged state, Expired tab
src/components/verification/*, src/components/account/StatCard.tsx (new)
src/db/seed/seed.ts                                SAMPLE view rows
tests: unit + *.integration.test.ts next to the modules above
```

## Implementation requirements

- Server Actions stay thin: Zod v4 input, then `requireUser`/`requireRole`, then rate limit, then
  a `lib/` function, then a typed result. `lib/verification/*` is `server-only` except the pure
  rules, retention, reminder-window and view helpers.
- Each state change and its audit row (and any supersede) go in one transaction, on the
  WebSocket client (`src/db/tx.ts`). Every job item locks its row and re-checks before writing,
  so a QStash retry or an overlapping run changes nothing.
- Every status change goes through `canTransition`.
- Job time comes from `deps.now()`, so `jobs:run --now` (fake clock, with its confirmation
  variable) can drive expiry, reminders and retention in tests and walkthroughs.
- Session reads stay inside `<Suspense>`. No route `runtime` exports. The dashboard's stats load
  in their own Suspense boundary with a skeleton, so a slow query never blocks the page.
- Stats queries are aggregate SQL (`count`, `sum`, `group by`), never row loops. Add indexes if
  `EXPLAIN` on dev shows sequential scans:
  - `inquiries (recipient_user_id, created_at)` already exists;
  - `favorites` may need `(property_id, created_at)`.

## UI requirements (compact system, design 01 and 02)

- **Stat card:** `rounded-lg border border-line bg-white p-5`; label `text-small font-medium
  text-slate-700`; figure `text-display-sm tabular`; change line `text-small`. Four across at
  `xl`, two at `sm`, one on phones. No shadows.
- **Comparison panel:**
  - a panel (`rounded-lg p-5`) with heading `text-title`;
  - a three-row table at `sm+` (metric / before / after / change), stacked rows on phones;
  - figures `tabular`, notes `micro text-slate-600`.
- **Verification page additions** reuse the S12 status card (`mint-50`). The Start re-review
  button is primary, `h-control`; Renew verification is secondary.
- **Admin:**
  - "Re-review of VR-…" is a `micro` meta line in the header card;
  - the purged state is a `bg-canvas` note in place of the document list.
- **Type:** only the six tokens. No `text-base`/`lg`/`xl`.
- **Phones:** checked at 390px with no horizontal overflow; full-width buttons.
- **Accessibility:** every change figure has text ("up 12%"), not colour alone; and the cards'
  links have a 44px hit area.

## Security requirements

- Re-review never grants anything. Only an admin's approve sets `verified`, and the badge stays
  derived from the one view.
- The re-review action checks that the session user owns the request it renews. Ids from the
  browser are lookups only.
- Purge deletes only objects under `verification/<listerUserId>/<requestId>/` for the request
  being purged. Keys come from the database, never from input.
- **Views:**
  - The action accepts only a uuid. It reveals nothing (same response whether counted or not).
  - Nothing personal is stored: the IP hash lives only as a short-lived rate-limit key.
  - Views never affect ranking or the badge.
- Stats queries are scoped to the session user. Agency members never see another member's
  numbers.
- Job routes keep QStash signature verification; `verification-lifecycle` is just a new name in
  the existing route.
- **Logs:** ids and counts only. No names, emails, phones, file names or IPs.
- `verification_audit_log` stays append-only. Each listed action writes exactly one row.

## Acceptance criteria

1. Migration 0007 applies on dev, test and **production**. A second `npm run db:generate`
   reports no changes.
2. Unit tests cover:
   - `canTransition`, including the new edge;
   - `canStartRereview`: each refusal and the 30-day boundary;
   - `rereviewReminderDue`: the 30d/7d edges, never both;
   - the retention policy: each status and boundary, and never open or verified;
   - `listerView` and `viewBadge`: every new state;
   - the percentage-change formatter (zero previous, down, flat);
   - the Nairobi day used for view counting.
3. Integration tests (test branch or PGlite):
   - **Expire.** The job expires a review past its date (`ended_at`, audit `expire`, one email
     claim); a second run changes nothing; `lister_verified_now` is false.
   - **Reminders.**
     - At 29 days the reminders send the 30d email once and skip SMS when it isn't configured;
       at 6 days they send the 7d reminder.
     - With an open re-review they send nothing.
     - A replaced review gets nothing.
   - **Re-review.**
     - It is refused at 31 days left, with a lapsed verification plan, when suspended, and with
       an open request.
     - It is allowed at 30 days, creating `documents_pending` with `renews_request_id` and audit
       `rereview`, while the badge stays true.
     - Approving it expires the old review (audit `supersede`) and gives the new one 12 months;
       the badge stays true throughout.
   - **Re-review rejection.** There is no `credit`/`credit_skipped` row, the verification
     subscription is still active, and the old badge stays until its expiry.
   - **Suspend with an open re-review.** The re-review is `rejected` with the closure reason, and
     billing ends as in S12.
   - **Retention.**
     - Rejected at 89 days: kept. At 90 days: rows gone, `documents_purged_at` set, audit
       `purge_documents`, objects deleted from the store.
     - Suspended at 23 months: kept.
     - Expired measures from `ended_at`.
     - A second run changes nothing.
     - The admin document route returns 404 afterwards.
   - **Verification renewal reminders.** A verification subscription 4 days from its end gets
     the 5d reminder with the verification wording; a cancelled one gets nothing.
   - **Views.**
     - The action counts once per visitor per 30 minutes, never for the owner, and never for a
       non-published listing.
     - Counts land on the Nairobi day.
     - The 30-day and before/after stats match the inserted rows.
     - User B's stats never include user A's listings.
4. **Browser walkthrough** on local dev, in Edge, using the fake clock through `jobs:run`:
   - A verified SAMPLE lister moved to 29 days left sees the re-review prompt, starts it, uploads
     and submits; an admin approves; the dashboard shows the badge and the new expiry.
   - Advancing past expiry with no re-review shows the expired state, and the badge leaves
     search.
   - The dashboard cards and the comparison panel are checked at 1280px and 390px, with 0
     console errors and no overflow.
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration` and
   `npm run build` pass.

## Checks to run

```bash
npm run db:generate          # creates 0007; re-run → "No schema changes"
npm run db:migrate           # dev (then test branch)
npm run typecheck && npm run lint && npm test
npm run test:integration
npm run build
```

- Production migration: `DATABASE_URL_UNPOOLED=<prod direct> npx drizzle-kit migrate`, then push
  to deploy.
- After the deploy, `npm run jobs:schedule` against the live URL registers the new
  `verification-lifecycle` schedule; it updates the existing six in place.

## Manual test steps (after implementation)

1. Restart `npm run dev` (new migration, job and action).
2. **Views and dashboard:**
   1. Open any published listing while signed out. Reload it: the view counts once (check
      **My listings → Views (30 days)** as the owner).
   2. Open your own listing while signed in: no count.
   3. Open `/account` as a SAMPLE lister: four stat cards. A verified SAMPLE lister also sees the
      "Since you were verified" panel.
3. **Re-review:**
   1. As a verified test lister (S12 walkthrough), run
      `npm run jobs:run -- verification-lifecycle --now <date 29 days before their expiry>`,
      with the fake-clock confirmation variable as in S11. The terminal prints the 30d reminder
      email.
   2. Open **Verification**: "Start re-review" appears. Start it, upload, submit.
   3. As admin, open the request: it is labelled "Re-review of VR-…". Approve it. The lister's
      page shows the new expiry a year out, and the old review shows as replaced in the admin
      Verified/Expired tabs.
4. **Expiry:** with a second verified test lister, run the job with `--now` after their expiry.
   - Their page reads "Your review ended on …" with Start re-review or Renew.
   - The badge is gone from Explore and from the detail page.
   - The terminal shows the expired email.
5. **Retention:** reject a third test lister's request. Run the job with `--now` 91 days later.
   - Admin → the request shows "Documents deleted on …".
   - The View links are gone.
   - The private bucket no longer has the files (dev disk: `.data/` private store folder).
6. **Renewal reminder:** run `npm run jobs:run -- renewal-reminders --now <4 days before a
   verification plan's end>`: the terminal prints the verification-wording reminder.
7. **Live site:** after I push and run `jobs:schedule`, the QStash console lists
   `vpk-verification-lifecycle` (daily 04:05 UTC). Views count on
   https://verifiedpropertieske.vercel.app, and the dashboard shows them.
