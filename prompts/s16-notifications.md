# S16 — Notifications and jobs

## Goal

Finish the Phase 2 "Notifications and jobs" scope (plan v2.0 §10) so that:

1. When someone gets a new message or inquiry and doesn't read it in-app, they get an **email**
   linking back to the signed-in conversation. **Email only, no SMS** (user decision, 8 Nov 2026).
2. Every message alert and payment receipt is recorded in a **delivery table** with its status.
   A failed send is retried with backoff and never loses the message or the payment.
3. Moderators get a daily **review-queue reminder** when listings or verification requests have
   waited too long.
4. Every job run is recorded, and admins have a read-only **Jobs & emails** page showing failed
   runs and failed deliveries.

Phase 2 exit items covered here: "Delivery status recorded; a failed notification never loses the
message or the payment"; "Idempotent QStash jobs for new-message alerts, payment receipts, renewal
reminders, verification expiry, listing review reminders and cleanup, with retries, backoff and a
failed-jobs view for admins". Launch checklist (§15): "Retries idempotent and delivery recorded".

Out of scope:

- SMS for anything new (SMS stays limited to the existing renewal and re-review reminders)
- an email-preferences or unsubscribe setting (see decision 9)
- moving `billing_reminders` and `verification_reminders` into the new table (decision 3)
- recording verification-decision and auth emails (decision 3)
- a "Run now" button or manual retries from the admin page (decision 12)
- real-time push, WhatsApp, digest emails for buyers

## References read

- `AGENTS.md` (sections 1–10)
- `docs/implementation-plan-v2.md`:
  - §10 "Notifications and jobs": Resend email with minimal personal data and a link back to the
    signed-in inbox or billing page; idempotent QStash jobs with retries, backoff and a
    failed-jobs view; delivery status recorded
  - §10 "Paid verification workflow": 2-working-day review target
  - §2 stack row: "Email | Resend | Notifications, receipts and renewal reminders, with minimal
    personal data"
  - §15 launch checklist: "Retries idempotent and delivery recorded"
- `prompts/s9-jobs.md`: decision 4 (idempotency comes from state, no `job_runs` table until the
  Phase 2 failed-jobs view), decision 8 (reminders claimed in a table before sending), decision 14
  (schedules, Nairobi times, about 150 deliveries a day), and the out-of-scope list that deferred
  the failed-jobs view, delivery status, new-message alerts, receipt retries and listing-review
  reminders to Phase 2
- `prompts/s15-messaging.md`: out of scope "email or SMS alerts for new messages (S16)"
- `prompts/s6-billing-ui.md` decision 5: receipt sent once, after the confirming transaction
- `prompts/s13-verification-lifecycle.md`: `verification_reminders` pattern
- `docs/PHASE1_REPORT.md` "Next steps": Resend is not yet set up on the live site
- Design: `3 - Lister & Admin Dashboards/03 — Admin Console & Moderation` (there's no jobs screen
  in the design, so the new page follows the admin console's tables and badges)

## Existing code inspected

- `src/lib/jobs/types.ts`, `registry.ts`, `handle-request.ts`, `schedules.ts`, `counter.ts`:
  `JOB_NAMES`, `runJob` (logs only, no record), 5xx triggers a QStash retry, `Counter.each` counts
  item failures as `failed`
- `src/lib/jobs/renewal-reminders.ts` + `src/db/queries/reminders.ts`: claim, send, finish pattern
  (`onConflictDoNothing`, then a failed row is reclaimed while `attempts < REMINDER_MAX_ATTEMPTS`)
- `src/lib/jobs/storage-cleanup.ts`: returns `skipped` when storage isn't configured
- `src/lib/email/send.ts` (`EmailTransport`, `maskEmail`, dev console transport, production
  refuses without Resend), `src/lib/email/templates.ts` (`layout`, `firstName`, `escapeHtml`)
- `src/lib/billing/receipts.ts`: `sendPaymentReceipt` / `receiptAfterConfirm`, called from
  `mpesa/settle.ts`, `mpesa/c2b.ts`, `card/settle-card.ts`, `billing/admin-actions.ts`. A failed
  send is logged and then lost.
- `src/db/queries/receipts.ts` `receiptRecipients` (owner, or agency admins; returns email and name,
  not the user id)
- `src/db/schema.ts`: `conversations`, `messages` (`readAt`, `removedAt`, `messages_unread_idx`),
  `user_blocks`, `billing_reminders`, `verification_reminders`, `verification_requests.submitted_at`,
  `users.email_verified`
- `src/db/queries/messaging.ts` (`sendMessage`, `appendMessage`, `markThreadRead`,
  `isBlockedBetween`), `src/db/queries/inquiries.ts` (an inquiry also appends a message, so
  inquiries are covered by message alerts)
- `src/lib/messaging/paths.ts` `conversationHref`
- `src/db/queries/moderation.ts`: the listings queue orders by `updated_at`, the time the listing
  entered `pending_review`
- `src/app/admin/layout.tsx`, `src/components/admin/AdminNav.tsx`, `src/app/admin/billing/page.tsx`,
  `src/components/admin/billing/BillingTables.tsx` (admin table, badge and empty-state patterns)
- `src/lib/roles.ts` `ADMIN_ROLES`; migrations up to `drizzle/0009_messaging.sql`

## Decisions and assumptions

1. **Message alerts are a scheduled job, not a per-send publish.** A new job, `notifications`,
   runs every 5 minutes. Sending a message stays one DB transaction with no network call, it
   works locally through `npm run jobs:run -- notifications`, and it uses the S9 state-based
   idempotency. The alert arrives 5 to 10 minutes after the message.

2. **One alert per unread streak.**
   - For each conversation and recipient, the streak starts at the recipient's **oldest unread
     message**: `read_at` null, `removed_at` null, sent by the other participant.
   - That message's id is the dedupe key. More messages in the same unread streak send nothing
     more. Once the recipient opens the thread (`markThreadRead`), the next message starts a new
     streak and can alert again.
   - A streak is due when its first message is at least **5 minutes** old, so someone reading
     in-app (with 10–15 s polling) is never emailed, and at most **24 hours** old, so deploying
     S16 doesn't email about old unread history.
   - **Skip** (recorded as `skipped` with a reason, never sent) when the conversation is closed,
     either side has blocked the other, or the recipient's email isn't verified.
   - The email covers the conversation's unread count at send time.

3. **New table `notification_deliveries`** records message alerts, payment receipts and review
   digests: one row per kind, reference, recipient and channel. Status moves
   `pending → sent | failed | skipped`, the same life cycle as `billing_reminders`. The two existing
   reminder tables already record delivery and keep working unchanged. The admin page reads all
   three. Verification-decision emails and auth emails (sign-up, reset) aren't recorded here: auth
   emails are retried by the user, and decision emails are a follow-up if needed.

4. **Retries with backoff.**
   - A failed row is retried by the `notifications` job while `attempts < 3`, once `updated_at` is
     at least `10 min × attempts` old: the 2nd try comes after about 10 minutes, the 3rd after
     about 20. After 3 failures the row stays `failed` ("Gave up" on the admin page).
   - Claim and reclaim follow the `reminders.ts` pattern, so a retry, an overlapping run or a
     replayed callback never sends twice.
   - A row stuck in `pending` for over 15 minutes (a crash mid-send) is treated as failed and
     reclaimed under the same attempt limit. That can, rarely, send a second copy, which is better
     than never sending a receipt.

5. **Payment receipts are recorded and retried.**
   - `receiptAfterConfirm` still sends inline, right after the confirming transaction commits (S6
     decision 5). Each recipient is now claimed in `notification_deliveries` first (kind
     `payment_receipt`, ref = payment id). `receiptRecipients` returns the user id as well.
   - A failure marks the row `failed`, and the `notifications` job retries it under decision 4. A
     failure still never blocks or undoes the confirmation.
   - Before S16, a replayed callback never reached the receipt code (`already_confirmed`). That
     stays true, and the unique row is a second guard.

6. **Review-queue reminders (the plan's "listing review reminders")** go to moderators. A new daily
   job, `review-reminders`, runs at 08:00 Nairobi time (`0 5 * * *` UTC) and sends each
   `platform_admin` with a verified email one digest, but only when something is overdue:
   - listings in `pending_review` with `updated_at` more than **24 hours** ago
   - verification requests in `under_review` with `submitted_at` more than **24 hours** ago (one
     day of slack before the 2-working-day target)

   The digest gives counts and the oldest wait for each queue, and links to `/admin/listings` and
   `/admin/verification`. It contains no lister names. Kind `review_digest`; the ref is the Nairobi
   date (`YYYY-MM-DD`), so each admin gets at most one a day.

7. **Email content is minimal personal data.**
   - **Message alert**
     - Subject: "New message about {listing title}"
     - Body: "Hi {first name}, you have {n} new message(s) about {listing title}. Sign in to read
       and reply."
     - Button: "Open conversation", linking to `{appUrl}{conversationHref(id)}`
     - Footnote: "You're getting this because someone messaged you on VerifiedPropertiesKE.
       Replies sent by email aren't delivered: reply on the site."
     - **No message text and no sender name or contact details.** The body can contain spam links
       (S15), and leaving out the text and the sender's name keeps personal data out of mailboxes.
       The listing title is public, and `layout()` escapes it.
   - **Review digest**
     - Subject: "{n} items waiting for review"
     - Details rows: "Listings waiting over 24 hours: {n} (oldest {age})" and the same for
       verification
     - Button: "Open listings queue"; the text version also carries the verification link
   - Both templates go in `src/lib/email/templates.ts` and reuse `layout()`.

8. **Job runs are recorded.**
   - New table `job_runs`. `runJob` inserts a `running` row and finishes it as `ok`, `skipped` or
     `failed`, with the duration, the counts (`jsonb`, counts only, never ids or contact data) and
     the error name only.
   - Recording is best-effort. If the insert or update throws, it's logged and the job's own
     result and HTTP status are unchanged.
   - A run that finished `ok` with `counts.failed > 0` is shown as "Partly failed".
   - A run still `running` after 15 minutes is shown as "Didn't finish".

9. **No preference toggle in this slice.** Message alerts are transactional replies to the
   person's own conversation, and every one carries a footnote saying why it was sent. An "Email me
   about new messages" setting is a small follow-up if users ask for it. Flag it at approval if you
   want it now.

10. **Cleanup.** `storage-cleanup` (daily, 03:00) gains a DB prune step that runs even when
    storage isn't configured:
    - delete `job_runs` older than **30 days**
    - delete `notification_deliveries` that are `sent` or `skipped` and older than **90 days**
    - failed rows are kept for 90 days too, then deleted

    When storage isn't set up, the job returns `ok` with `storageNotConfigured: 1` in its counts,
    where it used to return `skipped`.

11. **QStash budget.** The new schedules add 288 deliveries a day (every 5 minutes) and 1 a day,
    about **440 a day** in total. That's within QStash's free 1,000-a-day allowance. Document the
    new total next to `JOB_SCHEDULES`. `npm run jobs:schedule` registers both new schedules.

12. **The admin page is read-only.**
    - Route: `/admin/jobs`, nav label "Jobs & emails", open to `ADMIN_ROLES` (billing admins need
      to see `payment-checks` and receipt failures).
    - Retries are automatic (QStash for job runs, decision 4 for deliveries), and an operator can
      still run `npm run jobs:run -- <job>`.
    - Recipients show masked (`maskEmail`) with the delivery kind. Message text never appears,
      since none is stored.

13. **Constants live in one place:** `src/lib/notifications/constants.ts` holds `ALERT_DELAY_MIN = 5`,
    `ALERT_MAX_AGE_H = 24`, `DELIVERY_MAX_ATTEMPTS = 3`, `RETRY_BACKOFF_MIN = 10`,
    `STUCK_PENDING_MIN = 15`, `REVIEW_OVERDUE_H = 24`, `JOB_RUN_RETENTION_DAYS = 30`,
    `DELIVERY_RETENTION_DAYS = 90` and the batch sizes (alerts 100, retries 50).

## Files likely to change

New:

- `drizzle/0010_notifications.sql` (+ meta), generated by `npm run db:generate`
- `src/lib/notifications/constants.ts`
- `src/db/queries/notification-deliveries.ts`: `claimDelivery`, `finishDelivery`,
  `retryableDeliveries`, `pruneDeliveries`
- `src/db/queries/message-alerts.ts`: `dueMessageAlerts(db, now, limit)` returns conversation id,
  recipient id, recipient email and name, email-verified flag, listing title, first unread message
  id, unread count, closed flag and blocked flag
- `src/db/queries/job-runs.ts`: `startJobRun`, `finishJobRun`, `pruneJobRuns`, `jobOverview`,
  `failedRuns`
- `src/db/queries/jobs-admin.ts`: failed deliveries across the three tables, 24-hour counts by kind
- `src/lib/notifications/message-alerts.ts`: send one alert (claim, decide skip or send, finish)
- `src/lib/notifications/review-digest.ts`
- `src/lib/jobs/notifications.ts`: due alerts, then retries of failed or stuck message alerts and
  receipts
- `src/lib/jobs/review-reminders.ts`
- `src/lib/jobs/notifications.test.ts`, `src/lib/notifications/*.test.ts` (unit, fake clock and
  transport)
- `src/lib/notifications/notifications.integration.test.ts`
- `src/app/admin/jobs/page.tsx`, `src/components/admin/jobs/JobTables.tsx`

Changed:

- `src/db/schema.ts`: `notificationDeliveries`, `jobRuns`
- `src/lib/jobs/types.ts` (`JOB_NAMES` + `notifications`, `review-reminders`), `registry.ts`
  (record runs), `schedules.ts` (two schedules, budget comment), `storage-cleanup.ts` (DB prune)
- `src/lib/billing/receipts.ts` (per-recipient claim and finish, plus a function the job can call
  to resend one recipient's receipt), `src/db/queries/receipts.ts` (recipient id)
- `src/lib/email/templates.ts` (`messageAlertEmail`, `reviewDigestEmail`), `email.test.ts`
- `src/components/admin/AdminNav.tsx` ("Jobs & emails" for both admin roles)
- `src/lib/jobs/jobs.test.ts` / `jobs.integration.test.ts`, where the registry or cleanup behaviour
  changes
- `scripts/jobs-run.ts`, only if it lists job names itself
- `docs/implementation-plan-v2.md`: nothing; `.env.example`: nothing (no new variables)

## Implementation requirements

### Schema (`0010_notifications`)

`notification_deliveries`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | `defaultRandom()` |
| `kind` | text not null | check in (`message_alert`, `payment_receipt`, `review_digest`) |
| `ref` | text not null | message id, payment id or Nairobi date; check `char_length <= 64` |
| `recipient_user_id` | text not null | FK `users.id`, `on delete cascade` |
| `channel` | text not null default `'email'` | check in (`email`) |
| `status` | text not null default `'pending'` | check in (`pending`, `sent`, `failed`, `skipped`) |
| `attempts` | integer not null default 1 | check `>= 1` |
| `last_error` | text | error name or skip reason only; check `<= 100` chars |
| `sent_at` | timestamptz | |
| `created_at`, `updated_at` | `...timestamps` | `updated_at` set on every status change |

- unique `notification_deliveries_once` on (`kind`, `ref`, `recipient_user_id`, `channel`)
- partial index on (`updated_at`) where `status in ('failed', 'pending')`, for retries
- index on (`created_at`), for the prune and the admin page

`job_runs`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `job` | text not null | check `char_length <= 40` |
| `status` | text not null | check in (`running`, `ok`, `skipped`, `failed`) |
| `started_at` | timestamptz not null default now | |
| `finished_at` | timestamptz | |
| `duration_ms` | integer | check `>= 0` |
| `counts` | jsonb not null default `'{}'` | |
| `error` | text | name only; check `<= 100` chars |

- index on (`job`, `started_at desc`)
- index on (`status`, `started_at desc`)

Run `npm run db:generate`, review the SQL and commit it. Apply it to dev with `npm run db:migrate`.
Production is a separate operator step: it isn't run in this slice without the user's go-ahead.

### Message alerts

- `dueMessageAlerts` is one SQL query:
  - find the first unread message per (conversation, recipient) with `distinct on` over unread,
    not-removed messages from the other participant
  - keep rows whose first message is in the `[now − 24h, now − 5min]` window
  - exclude rows that already have a `notification_deliveries` row for (`message_alert`, that
    message id, recipient), in any status (retries are handled separately)
  - join the listing title, recipient email, name and `email_verified`, the conversation's
    `closed_at`, and a block check either way
  - order by first-message time, limited to the batch size
  - it uses `messages_unread_idx`; check the plan with `EXPLAIN` on dev and add an index only if
    needed
- For each row: `claimDelivery`, then
  - skip reasons: `conversation_closed`, `blocked`, `email_unverified`
  - otherwise send `messageAlertEmail`
  - then `finishDelivery`
- `Counter` keys: `alertsDue`, `alertsSent`, `alertsSkipped`, `alertsFailed`, `alreadyHandled`.
  Logs carry conversation ids and masked emails only.

### Retries (inside the `notifications` job, after the alerts)

`retryableDeliveries(db, now, limit)` selects rows of kind `message_alert` or `payment_receipt`
that are either:

- `failed`, with `attempts < 3` and `updated_at <= now − 10 min × attempts`, or
- `pending`, with `updated_at <= now − 15 min` and `attempts < 3`

Reclaim each one atomically (`update … set status='pending', attempts = attempts + 1 … where`
the same condition, `returning`), then:

- `message_alert`: re-read the current state with the same query, filtered to that message.
  - The message has since been read: finish as `skipped`, `read`.
  - The conversation is now closed or blocked: skip with that reason.
  - Otherwise resend.
- `payment_receipt`: resend that recipient's receipt for that payment.

A `review_digest` isn't retried: tomorrow's digest replaces it.

### Review reminders job

- Return `skipped` with `nothingOverdue: 1` when both queues have no overdue items.
- Otherwise claim one row per `platform_admin` recipient (`review_digest`, Nairobi date), send,
  then finish.
- Counts: `listingsOverdue`, `verificationsOverdue`, `digestsSent`, `digestsFailed`,
  `alreadyHandled`.

### Job-run recording (`registry.ts`)

```ts
export async function runJob(name, deps) {
  const runId = await startJobRunSafely(deps.db, name, deps.now());   // null if recording failed
  try {
    const result = await JOBS[name](deps);
    await finishJobRunSafely(deps.db, runId, { status: result.status, counts: result.counts, … });
    return summary;
  } catch (error) {
    await finishJobRunSafely(deps.db, runId, { status: "failed", error: errorName(error), … });
    throw error;                    // handle-request still returns 500, so QStash still retries
  }
}
```

Use wall-clock time for `duration_ms` and `deps.now()` for `started_at` and `finished_at`, so tests
on a fake clock stay deterministic.

### Admin page `/admin/jobs`

`requireRole(ADMIN_ROLES, "/admin/jobs")` inside `<Suspense>`. `robots: { index: false }`. Three
sections, each with `title` headings:

1. **Jobs.** One row per `JOB_NAMES` entry:
   - job name and the Nairobi schedule from `JOB_SCHEDULES`
   - last run time (Nairobi, relative plus absolute in `title`)
   - status `Badge`: OK (success), Partly failed (warning), Failed (danger), Skipped (neutral),
     Didn't finish (warning), Never run (neutral)
   - duration
   - failures in the last 7 days
   - an "Overdue" warning badge when there's no finished run within 2× the schedule interval
     (interval derived from a small map next to `JOB_SCHEDULES`, not parsed from cron)
2. **Failed runs (last 7 days).** Up to 50 rows: time, job, status, error name, and the counts as
   `key n` pairs (`micro`). `EmptyState` with a check icon: "No failed runs in the last 7 days."
3. **Emails.**
   - A 24-hour summary row per kind: sent, skipped, failed. The kinds are message alerts, receipts,
     review digests, renewal reminders (email/SMS) and re-review reminders (email/SMS).
   - Below it, up to 50 failed deliveries from the last 7 days across the three tables: time, kind,
     masked recipient, attempts, last error, and "Will retry" or "Gave up".
   - Empty state: "No failed emails in the last 7 days."

Queries are bounded (limits, 7-day window) and run in parallel with `Promise.all`.

## Security requirements

- `/api/jobs/[job]` is unchanged: the QStash signature is verified before anything runs, and the
  two new job names go through the same route.
- The admin page and its queries check `ADMIN_ROLES` on the server. There are no actions, so
  there's no mutation surface.
- Emails never contain message bodies, sender names, phone numbers, receipts or coordinates.
  Recipients come only from the DB on the server: the conversation's other participant, the
  payment's owner or agency admins, or `platform_admin` users.
- Only users with a verified email get message alerts and digests.
- `notification_deliveries`, `job_runs` and logs store ids, kinds, statuses, counts and error
  **names** only: no email addresses, phones, names or error messages. Logs mask emails with
  `maskEmail`.
- Blocks and moderator closes are respected at send time **and** retry time.
- Listing titles in emails are HTML-escaped by `layout()` and plain in the text part.
- No new environment variables. Production email still needs `RESEND_API_KEY` and `EMAIL_FROM`.
  Without them, production sends fail and are recorded as `failed` (`EmailNotConfiguredError`),
  which the admin page shows.

## Acceptance criteria

1. Buyer B sends a message to lister L, and L doesn't open it:
   - after 5 minutes, one `notifications` run sends L one alert linking to the conversation
   - a second message before L reads sends nothing more
   - after L opens the thread, a new message from B alerts again on a later run
2. If L reads within 5 minutes, no alert is sent and no row is created.
3. A new inquiry alerts the lister the same way, through its appended message.
4. Closed conversation, a block in either direction, or an unverified recipient email: the row is
   `skipped` with the reason, and no email is sent.
5. Unread messages older than 24 hours never alert (no backlog flood on deploy).
6. Running the `notifications` job twice, or two runs overlapping, sends each alert once.
7. A failing transport:
   - the alert row is `failed`, `attempts 1`
   - it's retried after 10 minutes, then after 20
   - after 3 failures it stays `failed` and isn't tried again
   - a retry after the recipient has read the thread finishes `skipped (read)`
8. A confirmed payment whose receipt email throws is still confirmed. Its `payment_receipt` row is
   `failed`, and a later `notifications` run sends it. A replayed callback doesn't create a second
   row or send a second receipt.
9. `review-reminders`:
   - with a listing pending for 25 hours, each platform admin gets one digest that day; a second
     run the same day sends nothing
   - with nothing overdue, it returns `skipped`
10. Every `runJob` call writes a `job_runs` row:
    - a job that throws records `failed` with the error name, and the route still returns 500
    - when recording itself fails, the job still runs and returns normally
11. `storage-cleanup` prunes `job_runs` older than 30 days and deliveries older than 90 days, even
    when storage isn't configured.
12. `/admin/jobs`:
    - works for platform and billing admins, and shows jobs, failed runs and failed emails with
      masked recipients
    - other users are redirected or refused like every other admin page
    - it reads well at 390px (tables scroll inside their card; the page itself doesn't scroll
      sideways)
13. `npm run jobs:schedule` lists 9 schedules, including `vpk-notifications` (`*/5 * * * *`) and
    `vpk-review-reminders` (`0 5 * * *`).

## Checks to run

- `npm run db:generate`: one new migration, `0010_notifications`, reviewed
- `npm run db:migrate` against dev
- `npm run typecheck`
- `npm run lint`
- `npm test` (new unit tests: streak logic, skip reasons, backoff windows, stuck-pending reclaim,
  templates escape the title and contain no body, digest thresholds, run recording on success,
  throw and recording failure)
- `npm run test:integration`: alert dedupe across two runs, read-then-new-message, block and close,
  receipt retry, digest once a day, prune
- `npm run build` (routes and server modules changed)

## Manual test steps (after implementation)

Dev server: `npm run dev`. Watch its terminal: without `RESEND_API_KEY` locally, emails print
there as "Development email" blocks with the masked recipient and the link.

1. **Message alert**
   - Sign in as a buyer in one browser and as the listing's lister in another (or private window).
   - As the buyer, send an inquiry or message on a published listing. Don't open it as the lister.
   - Wait 5 minutes, then run `npm run jobs:run -- notifications` (or skip the wait with
     `JOBS_FAKE_CLOCK_CONFIRM=yes npm run jobs:run -- notifications --now <ISO time 6 minutes from now>`;
     dev branch only).
   - Expect one "New message about …" email in the dev terminal, with a link to
     `/account/messages/<id>`, and the summary to show `alertsSent: 1`.
   - Send a second message as the buyer and run the job again: it should show `alreadyHandled` or
     nothing due, and no new email.
   - Open the conversation as the lister, send another buyer message, wait 5 minutes and run the
     job: a new email is sent.
2. **Skip.** As the lister, block the buyer. Have the buyer send before the block, wait 5 minutes
   and run the job: the summary shows `alertsSkipped: 1`, and `/admin/jobs` → Emails counts it as
   skipped.
3. **Failure and retry.** Temporarily set `RESEND_API_KEY=re_invalid` and `EMAIL_FROM` in
   `.env.local`, then run `npm run jobs:run -- notifications` after a new unread
   message:
   - the row is `failed` and appears on `/admin/jobs` as "Will retry"
   - remove the bad key, wait 10 minutes and run the job again: it sends
   - restore your env afterwards
4. **Review reminders.** As a lister, submit a listing so it's `pending_review`. To simulate age
   on dev only, run in the Neon SQL editor (dev branch):
   `update properties set updated_at = now() - interval '25 hours' where id = '<id>';`
   Then run `npm run jobs:run -- review-reminders` and expect one digest per platform admin. Run it
   again: `alreadyHandled`.
5. **Admin page.** Sign in as a platform admin and open `/admin/jobs`:
   - the jobs table shows the runs you just made
   - failed runs and failed emails are listed
   - check it at 390px width
6. **Receipt retry (sandbox).** With the bad Resend key from step 3, complete a sandbox STK payment
   from `/account/billing`:
   - the plan activates
   - `/admin/jobs` shows a failed receipt
   - restore the key, wait 10 minutes and run the job: the receipt is sent
7. **Schedules (after deploy).** Deploy, then run `npm run jobs:schedule -- --base-url https://<live
   host>` and confirm the two new schedules in the Upstash console.
8. **Production.** Apply `0010` to the production branch only after you approve it. Real alert
   emails on the live site still need Resend set up (`RESEND_API_KEY`, `EMAIL_FROM` with a verified
   domain).
