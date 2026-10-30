# S9 — Background jobs (Upstash QStash)

## Goal

Make the billing rules run without anyone pressing a button (plan v2.0 §4 and §9, "QStash jobs:
renewal reminders, grace-period expiry, pausing listings, nightly reconciliation", and "cleanup of
orphaned uploads through a QStash job"). This closes the Phase 1 exit criterion *"When the plan
lapses, the listing is paused after grace and returns on renewal."*

The jobs are signed endpoints under `/api/jobs/*`. Each one can run twice and nothing changes the
second time:

1. **`grace-expiry`** (hourly). After `grace_ends_at`, the subscription moves to `paused` and the
   pool's published listings move to `paused` with `pause_reason = 'plan_lapsed'`. They leave
   search. The S5 restore brings them back on renewal.
2. **`plan-changes`** (hourly). Three days after a downgrade takes effect, if the lister still has
   more live listings than the new plan allows, the newest stay live and the rest are taken out
   (S6 decision 4). Then the scheduled plan is written into `plan_id`.
3. **`renewal-reminders`** (daily, 07:00 Nairobi). Reminders go out 5 days and 1 day before a
   listing plan ends, by email, and by SMS through Africa's Talking when it is configured. Each has
   a Renew link. Each reminder is sent at most once.
4. **`payment-checks`** (every 15 minutes). Settles payments the callback path left pending:
   - STK payments whose callback arrived but was never settled
   - STK payments whose callback never arrived (STK Query alone may close them, never confirm them)
   - card payments the webhook missed, and stale declined card attempts
5. **`reconciliation`** (nightly, 01:00 Nairobi). Checks paid invoices against confirmed payments
   and flags mismatches for admins. It records a report as a `reconciliation` payment event, which
   S10 displays. It also gives the previous day's M-Pesa totals to compare with the M-Pesa
   statement.
6. **`storage-cleanup`** (nightly, 03:00 Nairobi). Runs the S4 `sweepOrphans`.

Also included:

- **`npm run jobs:schedule`** registers the six QStash schedules. It creates them or updates them
  in place.
- **`npm run jobs:run -- <job> [--now <ISO>]`** runs a job locally without QStash. A fake clock is
  allowed only with an explicit confirmation variable. S11 uses it for the forced-lapse
  walkthrough.

**Not in this slice:**

- an admin "failed jobs" view, delivery-status UI, new-message alerts, payment-receipt retries
  through QStash, and listing-review reminders (plan §10, Phase 2)
- verification-plan reminders, review-expiry reminders (30 and 7 days) and setting verification
  requests to `expired`. Verification can't be bought until Phase 2, and the badge is already
  derived from time in `verified_listers_now`, so no job is needed for it to be correct.
- showing the reconciliation report, and resolving flagged payments (S10)
- "your listings are paused" emails (not in the plan)
- comparing against the M-Pesa statement automatically. Daraja's standard APIs have no statement
  feed; the go-live checklist does this comparison by hand (plan §13 "Payments go-live").
- auto-renewal with Ratiba or card (Phase 5)

## References read

- `AGENTS.md` §§1–10, in particular:
  - §4: QStash replaces Vercel Cron
  - §5: `src/lib/jobs/` holds the job handlers
  - §6: lapse rules, a 3-day grace, restore up to the plan limit, the derived badge
  - §8: QStash job routes verify the signature; logs carry no secrets or personal data
  - §7: UTC in the database, Nairobi time in messages; masked phones in logs
- Plan v2.0:
  - §4 "Payment security" (nightly reconciliation), "Billing rules" (5-day and 1-day reminders by
    email and SMS with a Renew link), and "When a subscription lapses" (the table, plus the 3-day
    downgrade choice)
  - §3: the stack row for QStash (retries, backoff, scheduled jobs, signed requests), and SMS
    marked optional
  - §9: Phase 1 jobs and exit criteria
  - §10 "Notifications and jobs": Phase 2 scope, used to draw the boundary above
  - §13: the go-live reconciliation check
  - §15: the "Grace, pause and restore", "Renewal reminders" and "Nightly reconciliation" items
- Slice plan S9 (`~/.claude/plans/above-is-the-scope-immutable-torvalds.md`), and the S11 note
  "forced lapse (run the job with a fake clock)".
- Earlier prompts, for what they handed to S9:
  - `s2-billing-schema.md`: decision 8, where entitlement is computed from time so a missed job
    never grants access; and the `(status, grace_ends_at)` index added for S9
  - `s4-images.md`: decision 10, `sweepOrphans`
  - `s5-mpesa.md`: `settleStkPayment` is safe to run again; S9 handles payments stuck in pending
  - `s6-billing-ui.md`:
    - decision 3: the effective plan is computed, and S9 materialises it
    - decision 4: S9 picks the newest listings 3 days after `scheduled_change_at`
    - decision 16: S9 closes stale pending card payments
- Next 16 docs: `route.md` (Route Handlers), `route-segment-config/maxDuration.md`, `after.md`.
  `runtime` is not exported (AGENTS.md).
- `@upstash/qstash` 2.x (to be installed): `Receiver.verify` and `Client.schedules.create`, with
  `scheduleId` for in-place updates. I'll check the installed package's types before writing code.
- Africa's Talking SMS API: I'll check the current endpoint and fields in their docs before writing
  code. The sandbox host is used when `AT_USERNAME=sandbox`.

## Existing code inspected

- `src/db/schema.ts`:
  - `subscriptions`: statuses, period and grace columns, the schedule columns, and the live-slot
    unique indexes covering `pending`, `active`, `past_due` and `paused`
  - `properties`: `paused_at` and `pause_reason`
  - `payments` and `payment_events`, whose comment already lists `reconciliation` as an event type
- `src/lib/billing/periods.ts`: `subscriptionPhase`. A `paused` status reads as `lapsed`.
- `src/lib/billing/plan-change.ts`: a lapsed subscription renews as `restart`, a fresh period that
  starts at payment.
- `src/lib/mpesa/confirm.ts`:
  - `confirmPayment` sets the status to `active` on any live subscription, then calls
    `restorePausedListings` up to the limit
  - lock order: payment → invoice → subscription → properties
- `src/db/queries/payments.ts`:
  - `RESTORABLE_PAUSE_REASONS` covers `plan_lapsed` and `over_plan_limit`
  - also used: `restorePausedListings`, `recordPaymentEvent`, `lockSubscription`, `ownerOf`,
    `lastEventAt`
- `src/db/queries/billing.ts`: `effectivePlanIdAt`, `getListingSubscription` and
  `countActiveListings`.
- `src/db/queries/moderation.ts`: `approveListing` already refuses unless the plan is `active`. So
  a `pending_review` listing on a lapsed plan can't publish, and the lapse job can leave it alone.
- `src/lib/billing/plan-schedule.ts`: `keepListingsAfterDowngrade` pauses published listings that
  aren't kept (`over_plan_limit`) and sends unkept `pending_review` listings back to `draft`.
- `src/app/account/billing/page.tsx`: the choose-by deadline shown to the lister is computed from
  `scheduled_change_at + GRACE_DAYS`.
- `src/lib/billing/entitlements.ts`: `pickListingsToKeep` (newest published first, with stable ties).
- `src/lib/mpesa/settle.ts`: `settleStkPayment` returns `not_ready` when there is no callback.
  `result-codes.ts`: the query never confirms on its own.
- `src/lib/card/settle-card.ts`: `settleCardPayment(deps, id, source)`. A declined attempt stays
  `pending`, with the gateway status in `result_desc`.
- `src/lib/mpesa/c2b.ts`: unmatched Paybill money is recorded as a `c2b_confirmation` event with no
  invoice.
- `src/lib/storage/cleanup.ts` (`sweepOrphans`), `src/lib/storage/index.ts` (the stores) and
  `src/db/queries/listing-photos.ts` (`referencedBaseKeys`).
- `src/lib/billing/receipts.ts` and `src/db/queries/receipts.ts`: `receiptRecipients`, which is the
  owner, or every admin of an agency. Also `src/lib/email/send.ts` (the dev console transport,
  `maskEmail`) and `templates.ts` (`layout`).
- `src/lib/env.ts`: the `QSTASH_*` and `AT_*` variables, already optional.
- `scripts/lib/mpesa-script.ts`: `openScriptContext`, `parseArgs`, `run`, and node-postgres deps.
- `src/proxy.ts`: the matcher is `/account` and `/admin` only, so `/api/jobs` isn't redirected.
- `vercel.json`: region `fra1`, no crons. That stays.

## Decisions and assumptions

1. **The job runner.** Each job is a pure-ish function, `run(deps: JobDeps): Promise<JobSummary>`,
   in `src/lib/jobs/`. A typed registry (`JOBS`) maps each name to its function, cron and batch
   limit.
   - **Route:** `src/app/api/jobs/[job]/route.ts` exports `POST` only. An unknown job name returns
     404 before any work is done.
   - **Script:** `scripts/jobs-run.ts` calls the same function, so the route and the script can't
     drift apart.
   - `JobSummary` holds only counts and IDs. It never holds phones, emails or names. It is logged
     as `[jobs] <name> done {...}` and returned as JSON.

2. **Signature verification** (`src/lib/jobs/signature.ts`):
   - The route reads the raw body with `request.text()` and the `Upstash-Signature` header, then
     calls `Receiver.verify({ signature, body })` with the current and next signing keys.
   - A missing or invalid signature returns 401. Missing keys return 503 in every environment;
     there is no unsigned development bypass.
   - Local runs use `jobs:run`. The QStash CLI dev server can optionally sign requests to
     localhost; this is described in the test steps.
   - The URL claim isn't pinned. Vercel preview domains would cause false rejections, the
     body-hash and expiry claims are still checked, and every job is idempotent and harmless to
     repeat.

3. **Status codes, with QStash's retries in mind:**
   - 200 with the summary when the job finishes, even when some items failed. Failures per item
     are counted and logged, and those items are retried on the next run.
   - 500 only when the job couldn't run at all (for example the database is unreachable), so
     QStash retries with backoff.
   - Every schedule is registered with `retries: 3`.

4. **Idempotency comes from state, not from a run log.** Each job selects only rows still in the
   "to do" state, then locks and re-checks each row inside its own transaction before writing. A
   retry or an overlapping run finds nothing left to do. There's no `job_runs` table (that's the
   Phase 2 failed-jobs view). Reminders are the exception: they are deduplicated by a table
   (decision 8).

5. **Grace expiry** (`grace-expiry.ts`). Candidates are subscriptions with status `active` or
   `past_due` and `grace_ends_at <= now`, of either kind, up to the batch limit, using the S2
   `(status, grace_ends_at)` index. For each, in one transaction:
   - `lockSubscription`, then re-check the status and `grace_ends_at <= now`. A payment that just
     confirmed will have moved it forward, so the candidate is skipped.
   - Set the status to **`paused`**. This is a live status, so the row keeps the owner's single
     slot, and a renewal confirms onto the same row as a `restart` with a fresh period.
     `subscriptionPhase` and `verified_listers_now` already treat `paused` as lapsed. I'm not
     using `expired`, which would free the slot and break the subscription's history across
     renewals.
   - For a **listing** subscription: update the pool's `published` listings (by owner, or by
     agency for an agency plan) to `paused`, `paused_at = now`, `pause_reason = 'plan_lapsed'`,
     under `FOR UPDATE`.
     - `pending_review` listings are left alone. They keep their slot and their submission, and
       approval is already refused until the plan is active.
     - Other pauses, such as moderation, aren't touched.
   - For a **verification** subscription: only the status changes. The badge was already gone at
     `grace_ends_at`.
   - Record a `status_change` payment event:
     `{ entity: "subscription", subscriptionId, from, to: "paused", action: "grace_expired", pausedListings: n }`.
   - Lock order is subscription → properties, the same order as confirmation, so the two can't
     deadlock.
   - I'm not writing `past_due` during grace. The phase is computed from time (S2 decision 8), so
     the extra status write would add nothing.

   Restoring is already S5's job: `confirmPayment` → `restorePausedListings` (newest first, up to
   the limit). S9 adds no restore code, but it adds an integration test for the full lapse →
   pause → renew → restore cycle.

6. **Plan changes** (`plan-changes.ts`). Candidates are listing subscriptions with
   `scheduled_change_at <= now − 3 days`. For each, in one transaction:
   - Lock the subscription and re-check the schedule.
   - If the pool's active listings (`published` + `pending_review`) exceed the scheduled plan's
     limit, keep `pickListingsToKeep(active, limit)`. The rest are taken out exactly as the
     lister's own choice would do it:
     - published → `paused` (`over_plan_limit`)
     - pending_review → `draft`

     To share this, I'll extract the write half of `keepListingsAfterDowngrade` into
     `applyKeepSelection(tx, pool, keepIds, now)` in `plan-schedule.ts`. Both callers use it, and
     the lister's path behaves as before.
   - Then **materialise** the change: set `plan_id = scheduled_plan_id` and clear both schedule
     columns.
   - Record a `status_change` event:
     `{ action: "downgrade_applied", planFrom, planTo, autoKept, paused, toDraft }`.
   - Materialising waits for the 3-day mark on purpose. The billing page computes the lister's
     choose-by deadline from `scheduled_change_at`, and it must stay visible until then. Until
     materialised, the effective-plan `CASE` keeps entitlement correct.
   - A subscription that has lapsed (`paused`) still gets materialised and trimmed. Its published
     listings are already paused, so only `pending_review` rows can be over the limit.

7. **Renewal reminders: which and when** (pure `reminderDue(periodEnd, now)` in
   `reminder-window.ts`):
   - `"5d"` when `1 day < periodEnd − now ≤ 5 days`
   - `"1d"` when `0 < periodEnd − now ≤ 1 day`
   - otherwise none

   Candidates are listing subscriptions with status `active` or `past_due` and
   `current_period_end` in `(now, now + 5 days]`. A daily run sends each reminder once. If the job
   was down during the 5-day window, only the 1-day reminder goes out, never both at once.

   Renewing early moves `current_period_end`, so the subscription drops out of the window, and the
   new period gets its own reminders.

8. **Reminder deduplication: migration `0004_billing_reminders`.** A new table, `billing_reminders`:

   | Column | Type |
   |---|---|
   | `id` | uuid pk |
   | `subscription_id` | fk |
   | `period_end` | timestamptz not null |
   | `reminder` | text, check in (`5d`, `1d`) |
   | `channel` | text, check in (`email`, `sms`) |
   | `status` | text, check in (`pending`, `sent`, `failed`, `skipped`) |
   | `attempts` | int, default 1, check ≥ 1 |
   | `last_error` | text, error *name* only, check ≤ 100 chars |
   | `sent_at` | timestamptz |
   | `created_at`, `updated_at` | |

   - **Unique key:** `(subscription_id, period_end, reminder, channel)`.
   - **Flow per channel:**
     1. Claim the row with `INSERT … ON CONFLICT DO NOTHING RETURNING`. Only the claimer sends.
     2. Send.
     3. Set the status to `sent` (with `sent_at`), `failed` (with the error name), or `skipped`
        (SMS not configured, or no phone on file).
   - **Retries:** a later run re-claims `failed` rows for the same window with
     `UPDATE … SET status='pending', attempts=attempts+1 WHERE status='failed' AND attempts < 3 RETURNING`.
   - A row stuck in `pending` (the process died mid-send) is never resent. A missed reminder is
     better than a duplicate.
   - This is not a payment record, so it isn't append-only.

9. **Reminder content.** There's a new `renewalReminderEmail` in `templates.ts`, reusing `layout`:
   - Subject: "Your {Plan} plan ends in 5 days" or "Your {Plan} plan ends tomorrow".
   - Body: the end date in Nairobi time, then "Your listings stay live for 3 days after that, then
     they're paused until you renew."
   - Details: the plan, the end date and the price.
   - Button: "Renew plan".
   - Link: `${appUrl}/account/billing/checkout?plan=<code>`, where `<code>` is the plan in force at
     `period_end`. That's the scheduled plan when a downgrade is due by then, which is what S6
     charges on renewal. The link opens the existing checkout with the saved phone. It doesn't
     start a payment from a GET, so a mail scanner opening the link can't trigger an STK Push.
   - Recipients: `receiptRecipients`, which is the owner or every agency admin. First names only.
   - SMS (≤ 160 characters, no name): "VerifiedPropertiesKE: your {Plan} plan ends {d MMM}. Renew
     to keep your listings live: {appUrl}/account/billing". It goes to the `lister_profiles.phone`
     of each recipient that has one.

10. **SMS is optional** (`src/lib/sms/`). It mirrors the email transport:
    - With `AT_USERNAME` and `AT_API_KEY` set, it calls Africa's Talking (`AT_SENDER_ID` when set).
      `AT_USERNAME=sandbox` uses the sandbox host.
    - In development without them, it prints the message to the console with a masked phone.
    - In production without them, it reports "not configured", and the channel row becomes
      `skipped`. Nothing fails.
    - Logs mask the phone (`maskPhone`) and never print the API key or the message body.

11. **Payment checks** (`payment-checks.ts`). Each run has a batch cap, 10 STK and 10 card, because
    STK settling waits between queries. The job needs `getPaymentDeps()`; when that's null (no
    M-Pesa configured), the STK half reports `skipped`. Card is treated the same way.

    | Case | Action |
    |---|---|
    | STK `pending`, callback stored, last callback older than 2 minutes | `settleStkPayment` (as today's poller does) |
    | STK `pending`, no callback, older than 5 minutes | new `settleStkWithoutCallback`, described below |
    | card `pending`, older than 15 minutes, last `card_verify` older than 15 minutes | `settleCardPayment(deps, id, "job")` |
    | card `pending`, older than 24 hours, after that verify still not `success` | close it: `cancelled` when the gateway said `abandoned`, otherwise `failed` |

    `settleStkWithoutCallback` (in `settle.ts`) runs one STK Query, recorded as an `stk_query`
    event:
    - **definitive failure:** `closePayment` as `cancelled` (1032) or `failed`. No money moved.
    - **success, payment older than 30 minutes:** `flagPendingPayment(…, "missing_receipt")`. Only
      the callback carries the receipt and amount, so the query never confirms (S5 rule). An admin
      resolves the flag in S10.
    - **success, payment younger than 30 minutes:** leave it pending. The callback may still be on
      its way, and once a payment is flagged a late callback can no longer settle it.
    - **still processing, or unavailable:** leave it. Payments still pending after 24 hours are
      listed by reconciliation.

    The card close path gets a small `closeStaleCardPayment` in `settle-card.ts`. It locks the
    payment, re-checks `pending`, and records a `status_change` event. `CardSettleSource` gains
    `"job"`.

12. **Reconciliation** (`reconciliation.ts` and `src/db/queries/reconciliation.ts`). Read-only
    checks; nothing changes a payment's status:
    - **`paid_without_payment`:** a paid invoice with no confirmed payment.
    - **`multiple_payments`:** a paid invoice with more than one confirmed payment (money taken
      twice).
    - **`amount_mismatch`:** a confirmed payment whose `paid_amount_kes` differs from the invoice
      amount.
    - **`payment_invoice_not_paid`:** a confirmed payment whose invoice isn't `paid`.
    - **`unmatched_paybill`:** `c2b_confirmation` events with no invoice in the window. Money came
      in with no invoice.
    - **`flagged_open`:** the count of `flagged` payments, all time, with the first 50 IDs.
    - **`stuck_pending`:** payments still `pending` after 24 hours.
    - **`daily_totals`:** for the previous Nairobi calendar day, confirmed payments grouped by
      method, with count and KES sum, to compare against the M-Pesa statement by hand.

    How it runs:
    - The window is the last 35 days of invoices and payments, so the query stays small.
      `flagged_open` is all time.
    - The report is one `payment_events` row with `event_type = 'reconciliation'`. Its payload
      holds:
      - `{ ranAt, windowStart, checks: { name: { count, ids (≤ 50) } }, dailyTotals }`
      - invoice numbers and payment IDs only, never phones, receipts or names
    - `PaymentEventType` gains `"reconciliation"`.
    - When any check has a count above zero, the job logs `[jobs] reconciliation mismatches=…`
      at warn level. S10 surfaces the latest report.
    - Running it twice in one night writes two reports. That's harmless, because S10 reads the
      latest one.

13. **Storage cleanup** (`storage-cleanup.ts`) calls `sweepOrphans` with the configured public and
    private stores and `referencedBaseKeys`. When storage is `none` (production without R2), it
    returns `skipped`.

14. **Schedules** (`scripts/jobs-schedule.ts`, `npm run jobs:schedule`):
    - The destination is `${base}/api/jobs/<job>`, where `base` comes from `--base-url`, defaulting
      to `NEXT_PUBLIC_APP_URL`. The script refuses an `http:` or `localhost` destination.
    - Each schedule has a fixed `scheduleId` (`vpk-<job>`), so running the script again updates it
      in place. `--list` prints the existing schedules. Schedules named `vpk-*` that aren't in the
      registry are deleted.
    - Crons are in UTC (Nairobi is UTC+3, with no daylight saving):

      | Job | Cron (UTC) | Nairobi time |
      |---|---|---|
      | grace-expiry | `5 * * * *` | hourly at :05 |
      | plan-changes | `10 * * * *` | hourly at :10 |
      | payment-checks | `*/15 * * * *` | every 15 minutes |
      | renewal-reminders | `0 4 * * *` | 07:00 |
      | reconciliation | `0 22 * * *` | 01:00 |
      | storage-cleanup | `0 0 * * *` | 03:00 |

    - That's about 150 messages a day, inside QStash's free tier.
    - `QSTASH_URL` becomes optional in `env.ts`, for the region host (it defaults to the client's
      default).

15. **Fake clock** (`jobs:run -- <job> --now 2026-12-05T10:00:00Z`):
    - Allowed only when `JOBS_FAKE_CLOCK_CONFIRM=yes` is exported for that command. Otherwise the
      script exits with an explanation.
    - A future clock against a real database would pause real listings. That's why this follows the
      `ADMIN_CREATE_CONFIRM` pattern.
    - Without `--now`, the script uses the real clock and needs no confirmation.
    - The script also refuses `--now` when `NODE_ENV=production`.

16. **Time budget:** the route exports `maxDuration = 60`. Batch limits (100 subscriptions per run
    for the billing jobs, and the payment caps above) keep each run well under that. A backlog
    clears over the following runs.

17. **Dependency:** add `@upstash/qstash` (^2.12). No other new packages; Africa's Talking is
    called with `fetch`.

## Files likely to change

```
package.json                                   + @upstash/qstash; scripts jobs:run, jobs:schedule
.env.example                                   QStash notes (+ QSTASH_URL), AT notes, JOBS_FAKE_CLOCK_CONFIRM
src/lib/env.ts                                 + QSTASH_URL (optional url)
src/db/schema.ts                               + billingReminders
drizzle/0004_billing_reminders.sql (+ meta)    via npm run db:generate
src/db/queries/jobs.ts                         candidate selects: lapsing subs, due schedules, due reminders, stuck payments
src/db/queries/reminders.ts                    claim / reclaim / finish reminder rows; recipient phones
src/db/queries/reconciliation.ts               the read-only checks and daily totals
src/db/queries/payments.ts                     PaymentEventType + "reconciliation"; pausePoolListings
src/lib/billing/plan-schedule.ts               extract applyKeepSelection (behaviour unchanged)
src/lib/mpesa/settle.ts                        + settleStkWithoutCallback
src/lib/card/settle-card.ts                    + "job" source, closeStaleCardPayment
src/lib/email/templates.ts                     + renewalReminderEmail
src/lib/sms/send.ts                            SmsTransport, createSmsTransport (AT / dev console / not configured)
src/lib/jobs/types.ts                          JobName, JobDeps, JobSummary
src/lib/jobs/registry.ts                       JOBS: name → run, cron, description
src/lib/jobs/signature.ts                      verifyQstashRequest
src/lib/jobs/handle-request.ts                 route logic: name check → signature → run → JSON
src/lib/jobs/app-deps.ts                       getJobDeps() for the app
src/lib/jobs/reminder-window.ts                reminderDue (pure)
src/lib/jobs/grace-expiry.ts
src/lib/jobs/plan-changes.ts
src/lib/jobs/renewal-reminders.ts
src/lib/jobs/payment-checks.ts
src/lib/jobs/reconciliation.ts
src/lib/jobs/storage-cleanup.ts
src/app/api/jobs/[job]/route.ts                POST only, maxDuration = 60
scripts/jobs-run.ts
scripts/jobs-schedule.ts
scripts/lib/job-script.ts                      script JobDeps over node-postgres (reusing mpesa-script helpers)
tests: reminder-window.test.ts, signature.test.ts, registry.test.ts, sms.test.ts, templates (email.test.ts),
       jobs.integration.test.ts, reconciliation.integration.test.ts
```

## Implementation requirements

1. **The registry and its types.** `JobName` is a string-literal union of the six names.
   - `JobDeps` = `Pick<BillingDeps, "db" | "withTransaction" | "now" | "email" | "appUrl">`, plus:
     - `sms: SmsTransport`
     - `payments: PaymentDeps | null`
     - `card: CardDeps | null`
     - `storage: { public: ObjectStore; private: ObjectStore } | null`
     - `batchSize?: number` (tests)
   - `JobSummary` = `{ job, status: "ok" | "skipped", durationMs, counts: Record<string, number>, ids?: Record<string, string[]> }`.
   - `getJobDeps()` builds these lazily. A missing optional service makes that part `null`, never
     an exception.
   - Lint must pass: no `any`, explicit return types on exports.

2. **The route.**

   ```ts
   export const maxDuration = 60;
   export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[job]">) { … }
   ```

   - Check the Next 16 `route.md` for the exact `params` typing (a Promise) and the
     `RouteContext` helper.
   - Unknown job → 404. Missing signing keys → 503. Bad signature → 401. Job finished → 200 with
     the summary. A thrown error → 500 with a body of `{ error: "job_failed" }` (no message), and
     the error name logged.
   - No `GET`. No caching concerns, because a route that only has `POST` is dynamic.

3. **Grace expiry, plan changes, reminders, payment checks, reconciliation and cleanup** behave as
   decisions 5, 6, 7–10, 11, 12 and 13 describe.
   - Every write runs in `deps.withTransaction` with row locks.
   - Every candidate is re-checked under its lock.
   - One failing item is caught and counted (`failed`), with the error name logged, and the run
     carries on.

4. **`pausePoolListings(tx, pool, now)`** in `payments.ts`, next to `restorePausedListings`, with
   the same pool condition. It returns the paused IDs.

5. **`applyKeepSelection`.** Extract it without changing behaviour. The existing S6 integration
   tests for `keepListingsAfterDowngrade` must still pass unchanged.

6. **Migration.** Generate it with `npm run db:generate` (don't write it by hand), then apply it
   with `npm run db:migrate` to the dev branch. The integration tests use the test branch, so apply
   it there too: the test setup already migrates, so I'll confirm how and follow it.

7. **Scripts.**
   - `jobs:run` prints the summary as a table, and exits with 1 when the status is `failed`.
     Usage:
     `npm run jobs:run -- <job> [--now <ISO>] [--batch <n>]`
   - `jobs:schedule` needs `QSTASH_TOKEN`. It prints each schedule's ID, cron and destination, and
     never prints the token.
   - Both run with `--conditions=react-server`, like the M-Pesa scripts.

8. **Logging.**
   - `[jobs] <name> start`
   - `[jobs] <name> done {counts}`
   - per-item failures: `[jobs] <name> item failed id=<uuid> error=<ErrorName>`
   - Logs carry no phones (masked), no emails (masked), no names and no tokens.

## Security requirements

- Every `/api/jobs/*` request must pass QStash signature verification against the raw body before
  any database read. There is no development bypass, no query-string secret, and no `GET`.
- Signing keys and `QSTASH_TOKEN` stay server-only and are never logged. `AT_API_KEY` too.
- Jobs take no input from the request body. The body is only verified, never parsed into
  parameters, so a valid signature can't steer what a job does. The fake clock exists only in the
  CLI, behind `JOBS_FAKE_CLOCK_CONFIRM=yes`, and is refused in production.
- Jobs never grant anything:
  - no job confirms a payment without the S5 rules (callback plus query, or card Verify)
  - no job extends a period
  - no job publishes anything except through the existing `restorePausedListings` on confirmation
- Reconciliation and reminder payloads hold IDs and counts only, never phones, receipts, emails
  or names.
- The reminder link is a plain page link. Starting an STK Push still needs a signed-in POST (the
  S6 Server Action and its rate limits).
- Public visibility doesn't change: paused listings are already excluded by `publishedOnly`.

## Acceptance criteria

1. **Lapse and restore (exit criterion).** A listing plan past `grace_ends_at` with 2 published
   listings and 1 pending:
   - after `grace-expiry`, the subscription is `paused`, both published listings are `paused`
     (`plan_lapsed`) and gone from public queries, and the pending one is still `pending_review`
   - a second run changes nothing and reports 0
   - a confirmed renewal payment then sets the subscription `active` with a fresh 30-day period
     and restores the listings to `published`, newest first, up to the limit
2. A subscription renewed between candidate selection and its lock isn't paused (the re-check
   works).
3. A subscription in grace (`period_end < now < grace_ends_at`) isn't touched. Its listings stay
   live.
4. An agency plan lapse pauses every member's published listings in the agency pool, and no one
   else's.
5. **Downgrade auto-pick.**
   - At change + 2 days, nothing happens and the billing page still shows the deadline.
   - At change + 3 days with 5 live listings and a limit of 2: the newest 2 stay, the other
     published ones are `paused` (`over_plan_limit`), and pending ones go to `draft`. Then
     `plan_id` equals the old `scheduled_plan_id` and the schedule is cleared.
   - A second run does nothing.
   - When the lister has already chosen, only the materialisation happens.
6. **Reminders.**
   - At 4.5 days before the end, one `5d` email goes to the owner, or to each agency admin.
   - A second run the same day sends nothing.
   - At 0.5 days, one `1d` email goes out.
   - After an early renewal, no further reminder goes out for the old period end.
   - A failed send is retried on the next run, at most 3 attempts.
   - Without AT configuration, the SMS rows are `skipped` in production mode and printed to the
     console in development.
7. **Payment checks.**
   - A pending STK payment with a stored callback older than 2 minutes is settled through the
     fake Daraja.
   - With no callback and a query answering 1032, it's `cancelled`.
   - With no callback, a successful query and an age of 20 minutes, it's untouched. At 40 minutes,
     it's `flagged` with `missing_receipt`.
   - A stale abandoned card payment (over 24 hours) is `cancelled` once the fake gateway still
     says `abandoned`.
   - Nothing is ever confirmed without a receipt.
8. **Reconciliation.** Seeded inconsistencies (a paid invoice without a payment, a confirmed
   payment with the wrong amount, an unmatched Paybill event, a payment stuck in pending) each
   show up under the right check with the right IDs, in one `reconciliation` event. A clean
   database gives all-zero checks.
9. **Cleanup.** `storage-cleanup` against the memory store deletes old, unreferenced objects only.
10. **The route.**
    - No signature → 401.
    - A tampered body → 401.
    - A valid signature, made in the test with a known key → 200 and the job runs.
    - An unknown job → 404.
    - No keys → 503.
    - `GET` → 405.
11. **Scripts.**
    - `jobs:run -- grace-expiry --now …` without `JOBS_FAKE_CLOCK_CONFIRM=yes` refuses.
    - `jobs:schedule` against an `http://localhost` base refuses.
12. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration` and
    `npm run build` all pass.

## Checks to run

- `npm run db:generate`, then `npm run db:migrate` (the dev branch)
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (the test branch)
- `npm run build` (new routes and config)

## Manual test steps (after implementation)

**A. Locally, without QStash, with a fake clock (works today with your current `.env`)**

1. Run `npm run db:migrate`.
2. Sign in as a lister with a paid Starter plan and one published listing. Use
   `npm run mpesa:pay` / `mpesa:simulate` from S5 if you need a fresh one.
3. Run `npm run mpesa:status -- <invoice>` and note `current_period_end`.
4. In Git Bash, run this with a time after the grace end (period end + 3 days + 1 hour):

   ```
   JOBS_FAKE_CLOCK_CONFIRM=yes npm run jobs:run -- grace-expiry --now <period_end + 3 days + 1 hour, ISO>
   ```

   - Expected: `paused subscriptions: 1`, `paused listings: 1`.
   - `/properties` no longer shows the listing.
   - `/account/listings` shows it as Paused.
5. Run the same command again. Expected: all zeros.
6. Renew from `/account/billing` (Renew → simulate the payment). The listing is published again
   and back in `/properties`.
7. Reminders: run

   ```
   JOBS_FAKE_CLOCK_CONFIRM=yes npm run jobs:run -- renewal-reminders --now <period_end − 4 days>
   ```

   The dev server terminal isn't involved here; the script itself prints the "Development email"
   block with the Renew link (and a dev SMS line if your profile has a phone). Run it again:
   nothing is sent.
8. Run `npm run jobs:run -- reconciliation`. Expected: a summary table, all zeros on a clean dev
   branch.
9. Run `npm run jobs:run -- payment-checks` and `npm run jobs:run -- storage-cleanup`. Expected:
   summaries with counts.

**B. The route's signature check (local)**

10. Run `npm run dev`, then:

    ```
    curl -i -X POST http://localhost:3000/api/jobs/grace-expiry
    ```

    Expected: `503` without signing keys in `.env`. Once the keys are set, the same call returns
    `401`.
11. Run `curl -i -X POST http://localhost:3000/api/jobs/nope`. Expected: `404`.
12. Optional, a fully signed local call: run `npx @upstash/qstash-cli dev`, put its printed
    `QSTASH_URL`, `QSTASH_TOKEN` and signing keys in `.env.local`, restart `npm run dev`, then
    publish to `http://localhost:3000/api/jobs/reconciliation` with its token. Watch the dev server
    terminal for `[jobs] reconciliation done`.

**C. Production schedules (once deployed)**

13. In the Upstash console, open QStash and copy `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY` and
    `QSTASH_NEXT_SIGNING_KEY` (plus `QSTASH_URL` if your region shows one).
    - Add all of them to the Vercel project.
    - Add the token to `.env.local` for the script.
    - Redeploy.
14. Run `npm run jobs:schedule -- --base-url https://<your-vercel-domain>`. Expected: 6 schedules
    printed. Then run `npm run jobs:schedule -- --list`.
15. In the QStash console, trigger `vpk-reconciliation` once by hand. Check that it shows 200, and
    that the Vercel function log shows `[jobs] reconciliation done`.
16. Optional: create an Africa's Talking sandbox app and set `AT_USERNAME=sandbox` and
    `AT_API_KEY`. Repeat step 7, and the SMS appears in the AT sandbox simulator.
