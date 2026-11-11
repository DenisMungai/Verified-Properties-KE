# S21 Monitoring and operations (Phase 4, part 3)

## Goal

Make sure someone hears about problems on the live site before users do, and that the team
knows what to do next (plan §12 "Quality and operations"; launch checklist "Monitoring and
alerts live, including payment-callback alerts", "Backup and restore rehearsed").

1. **Health checks.** UptimeRobot polls two URLs every 5 minutes and emails you when one fails:
   - `GET /api/health` (public): the site and database are up.
   - `GET /api/health/ops/<token>` (secret path): background jobs are on time, no job is
     failing, and **M-Pesa callbacks are arriving**.
2. **Error alerts.** Sentry (free plan) records server and browser errors with personal data
   stripped, and emails you about new issues.
3. **Log review.** Server logs carry no personal data or raw provider errors. The few that do
   are fixed.
4. **Backup restore rehearsal.** Restore production to a point in time on a temporary Neon
   branch, check it, time it, delete it, and write down how.
5. **Operations runbook**, `docs/OPERATIONS.md`: every alert, what it means, and what to do;
   plus rollback, restore and secret-rotation steps.

**Alerts go to:** `mungaidenis45@gmail.com` (your choice, 2026-11-10). It's entered in the
UptimeRobot and Sentry alert settings, never in the code or the repo.

**Out of scope:**
- paging or SMS alerts
- performance tracing (Sentry traces are off)
- session replay
- emails sent by the app itself (Resend has no domain yet)

## References read

- `docs/implementation-plan-v2.md`:
  - §12 Quality and operations: "Error monitoring and alerts, including an alert when payment
    callbacks stop arriving. Structured logging, backup restore rehearsal, incident-response
    note."
  - §15 Operations checklist
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md` and
  `instrumentation-client.md`:
  - `register()` runs once per server instance
  - `onRequestError(err, request, context)` reports server errors
  - `instrumentation-client` runs in the browser before hydration
- `AGENTS.md`:
  - §8: structured logs contain no secrets or personal data; privileged keys are server-only
  - §9: checks and the migration workflow (none needed here)
- `docs/SECURITY_TESTS.md`: the scans and sweep new routes must pass
- Memory `vercel-deploy-state`:
  - Vercel project `verified-properties-ke` in team `45-creatives`
  - Neon production branch `br-mute-star-b92vpkso` in project `falling-sky-58396938`
  - push to `main` deploys

## Existing code inspected

- **Jobs:**
  - `src/db/queries/job-runs.ts` `jobOverview(db, since)`: latest run, last finished, failures
    per job
  - `src/lib/jobs/admin-view.ts` `isOverdue(lastFinished, hasRun, intervalMs, now)`
  - `src/lib/jobs/schedules.ts` `JOB_INTERVAL_MS`, and `JOB_NAMES`

  The admin Jobs page already shows "Overdue", but nobody is told.
- **Payments:**
  - `payment_events` records `stk_push`, `stk_push_failed`, `stk_callback`, `stk_query`,
    `status_change` and `callback_rejected`, each with `payment_id` and `created_at`
  - Pending STK payments are later settled by STK Query in the jobs, so a missing callback
    doesn't lose money. That's also why nobody notices when callbacks stop.
- **No instrumentation file, health route or monitoring dependency exists.**
- **Logs:** 84 `console.*` calls. Most log ids, masked emails and phones (`maskEmail`,
  `maskPhone`) and error *names*. Five print raw error text:
  - `src/lib/card/start-card-payment.ts:62` `error=${error}`
  - `src/lib/jobs/renewal-reminders.ts:55` and `:74` `error=${error}`
  - `src/lib/auth-config.ts:44` `error.message`
  - `src/lib/jobs/verification-lifecycle.ts:75` `error=${result.error}`, an SMS provider string

  Daraja's `pushed.error` (`start-payment.ts:99`) is checked during implementation.
- **Neon production branch** `br-mute-star-b92vpkso`:
  - primary and default
  - **`protected: false`**: anyone with console or API access can delete or reset it
  - logical size about 35 MB
- **Sentry:** `@sentry/nextjs` peer range includes `next ^16`. **10.77.1** (27 Oct) is the
  newest release at least two weeks old.

## Decisions and assumptions

1. **UptimeRobot (free plan)** does the polling and the outage emails. There's no app-side
   scheduler or email for this, so alerts still work when the app's own jobs or QStash are the
   thing that broke. You create the account and two HTTP monitors (manual steps).
2. **`GET /api/health` (public):**
   - Runs `select 1` with a 3 s timeout.
   - Up: `200 {"status":"ok"}`. Down: `503 {"status":"down"}`. Nothing else is returned.
   - `Cache-Control: no-store`. No rate limit: it does one indexed query, and UptimeRobot polls
     every 5 minutes.
3. **`GET /api/health/ops/[token]`:**
   - **The token:** new `OPS_HEALTH_TOKEN`, at least 24 characters, compared in constant time.
     A missing or wrong token gets `404` with no body, like the payment callback paths.
   - **The checks**, as pure rules in `src/lib/monitoring/rules.ts` over data read by
     `src/db/queries/ops-health.ts`:
     - **`database`:** reachable.
     - **`jobs_overdue`:** any job in `JOB_NAMES` that is `isOverdue` (no finished run in twice
       its interval).
     - **`jobs_failing`:** any job whose latest run is `failed`.
     - **`payment_callbacks`:**
       - Considers STK pushes recorded between 2 hours and 15 minutes ago (`stk_push` events).
       - It fails when at least 2 of them, **and** at least half, have no `stk_callback` event
         for the same payment.
       - With fewer than 2 pushes in the window, it passes: no traffic is not an outage.
       - The thresholds are named constants.
   - **The response:**
     - All pass: `200 {"status":"ok","checks":{…:"ok"}}`.
     - Any fail: `503`, with the failing check names and, for jobs, the job names. No ids,
       amounts or personal data.
   - The token lives in the UptimeRobot monitor URL, which is a third party. It's read-only, so
     a leak exposes only check names. The runbook says how to rotate it.
4. **Sentry:**
   - **Setup:** `@sentry/nextjs@10.77.1`, pinned exactly.
     - `src/instrumentation.ts`: `register()` loads the server and edge init, and
       `onRequestError = Sentry.captureRequestError`.
     - `src/instrumentation-client.ts`: browser init.
     - `next.config.ts` wrapped in `withSentryConfig`, with source-map upload **off** unless
       `SENTRY_AUTH_TOKEN` is set. It isn't, for now.
   - **Enabled only when `NEXT_PUBLIC_SENTRY_DSN` is set**, so local dev and tests send nothing.
     A DSN is designed to be public; it can only *send* events.
   - **Personal data stripped**, in one shared module, `src/lib/monitoring/scrub.ts`:
     - `sendDefaultPii: false`
     - `beforeSend` and `beforeBreadcrumb` remove request cookies, headers, body and query
       string, plus the user
     - masks email addresses, Kenyan phone numbers (`07…`, `01…`, `+254…`, `254…`) and long
       tokens or keys in messages, exception values and breadcrumbs
     - drops `console` breadcrumbs
     - unit tested
   - **Off:** `tracesSampleRate: 0`, and no replay or profiling.
   - **Not reported:** Next's `NEXT_REDIRECT` and `NEXT_NOT_FOUND` control-flow errors (the SDK
     already ignores them; this is checked).
   - `environment` is `VERCEL_ENV` (production or preview) when set.
   - Alerts: Sentry's default "email me on new issues" rule, to your email (manual steps).
5. **Log fixes:**
   - The five raw-error logs become `errorName(error)` (the existing helper), or the provider's
     short status code where that's all we need.
   - A new unit test scans `src/**/*.ts` `console.*` calls. It fails on `${error}`,
     `error.message` or `${…email}` / `${…phone}` unless wrapped in `errorName`, `maskEmail` or
     `maskPhone`, or on an explicit allowlist with a reason.
6. **Backup restore rehearsal** (I run it with the Neon tools; approving this prompt approves
   these steps):
   1. Read the project's history retention setting and record the restore window.
   2. Create a temporary branch `restore-rehearsal-2026-11-10` from **production as of one hour
      ago** (point in time), with its own compute.
   3. Read-only on both, compare:
      - row counts of `users`, `properties`, `property_images`, `subscriptions`, `invoices`,
        `payments`, `payment_events`, `verification_requests`, `messages` and `data_requests`
      - the latest `created_at` in `payment_events` and `job_runs`

      Every difference must be explained by activity in the last hour.
   4. Time it from the request to a queryable branch.
   5. **Delete the temporary branch** once it's verified. No change is made to production at any
      point.
   6. Record the steps, timings, the restore window and how to point the app at a restored
      branch (Vercel `DATABASE_URL`) in `docs/OPERATIONS.md`.
7. **Production branch protection.** Neon's "protected branch" setting stops accidental deletes
   and resets. I recommend you turn it on (manual step); I don't change it.
8. **No database changes.** No migration and no new tables. The checks read existing tables
   only.

## Files likely to change

- `src/app/api/health/route.ts`, `src/app/api/health/ops/[token]/route.ts` (new, thin)
- `src/lib/monitoring/rules.ts` (+ `.test.ts`), `src/lib/monitoring/scrub.ts` (+ `.test.ts`),
  `src/lib/monitoring/sentry-options.ts` (shared init options)
- `src/db/queries/ops-health.ts` (+ `ops-health.integration.test.ts`)
- `src/instrumentation.ts`, `src/instrumentation-client.ts` (new)
- `next.config.ts` (`withSentryConfig`)
- `src/lib/env.ts` (`OPS_HEALTH_TOKEN` optional, ≥ 24 characters) and `src/lib/env.test.ts`
- `.env.example`:
  - `NEXT_PUBLIC_SENTRY_DSN`, `OPS_HEALTH_TOKEN` and `SENTRY_AUTH_TOKEN` (optional, unused for
    now), with comments
  - `.env` gets empty placeholders
- The five log call sites; `src/lib/log-hygiene.test.ts` (new scan)
- `src/app/route-guards.test.ts`:
  - the ops route must compare its token
  - the public health route must return only `status`
- `scripts/security-sweep.ts`:
  - `/api/health` returns 200 with only `status`
  - `/api/health/ops/wrong-token` returns 404
- `docs/OPERATIONS.md` (new); `docs/SECURITY_TESTS.md` (one line)
- `scripts/sentry-test.ts` (new) and `package.json` (`sentry:test`): one scrubbed test event
- `package.json` and `package-lock.json` (`@sentry/nextjs@10.77.1`)

## Implementation requirements

1. **Before coding Sentry,** check the current `@sentry/nextjs` Next.js manual-setup docs against
   10.77.1:
   - file names and `withSentryConfig` options
   - Turbopack and Next 16 notes
   - how to turn source-map upload off without a token

   Follow them where they differ from decision 4, and record the difference in this prompt as
   an amendment.
2. **Route handlers stay thin.** They call `runOpsChecks(deps, now)` (pure, given read
   functions) and map the result to a status code. No logic in the route files.
3. **Callback-stall query:**
   - One SQL statement on `payment_events`: pushes in the window, left-joined to the first
     `stk_callback` for the same `payment_id`.
   - It uses the existing `payment_events_payment_idx`.
   - Integration test with fixtures:
     - pushes with callbacks pass
     - 2 of 3 without callbacks fail
     - 1 push without a callback passes (under the minimum)
     - pushes newer than 15 minutes are ignored
4. **Jobs checks** reuse `jobOverview` and `isOverdue` unchanged.
5. **`scrub.ts` unit tests cover:**
   - an event with cookies, headers, a body, a query and a user comes out without them
   - `jane@example.com` → `j***@example.com`-style masking, matching `maskEmail`
   - `+254712345678` and `0712345678` masked
   - a 40-character token masked
   - console breadcrumbs dropped
   - a normal error message kept
6. **Sentry only initialises with a DSN.** `npm run build` without one completes with no
   warnings that fail the build. Run once locally with a throwaway DSN-less build, and once with
   `NEXT_PUBLIC_SENTRY_DSN` set if you've provided it by then.
7. **The log-hygiene scan** is plain source matching, like the route-guard scan, with an
   allowlist of named exceptions and their reasons.
8. **Restore rehearsal** follows decision 6. The temporary branch is deleted in the same
   session, and its id and timings go in the runbook.
9. **`docs/OPERATIONS.md` sections:**
   1. Monitors and alerts: what is watched, where alerts go, how to pause them
   2. Alert runbooks:
      - site down
      - `jobs_overdue`
      - `jobs_failing`
      - `payment_callbacks`: check Daraja status, the callback URL and token, the IP
        allowlist, and Vercel logs for 403s; the reconciliation job and STK Query still settle
        payments
      - new Sentry issue
      - flagged payments
   3. Roll back a bad deploy: Vercel → Deployments → previous Ready → Promote, or `git revert`
      and push
   4. Restore from backup: from the rehearsal, with the steps and timings
   5. Rotate a secret: `OPS_HEALTH_TOKEN`, `MPESA_CALLBACK_TOKEN`, database passwords, Sentry
      DSN, Upstash
   6. Incident note template: what, when, impact, cause, fix, follow-ups
   7. What isn't monitored yet:
      - email delivery, once Resend is configured
      - Daraja production, at S23 go-live

## Security requirements

- **`OPS_HEALTH_TOKEN`:** server-only, compared in constant time, 404 on mismatch, never logged.
  Rotating it is documented.
- **Public health route:** returns only `{status}`. It leaks no version, region, error text or
  timings.
- **Ops route:** returns check names and job names only. No ids, amounts, emails or phones.
- **Sentry:**
  - personal data stripped before sending (scrubber unit-tested)
  - `sendDefaultPii: false`
  - no replay
  - no request bodies, cookies or headers
  - the DSN is the only Sentry value in the browser
  - `SENTRY_AUTH_TOKEN`, if ever added, is server-only and build-time only
- **Alert email:** kept in UptimeRobot and Sentry settings, never in the repo or code.
- **Restore rehearsal:**
  - production is read only, never written
  - the temporary branch is deleted
  - its connection string is never printed
- **Checks:** the route-guard scan and sweep extended as listed. No new action or page.

## Acceptance criteria

- **Health routes:**
  - `GET /api/health` returns `200 {"status":"ok"}`, or `503 {"status":"down"}` when the
    database is unreachable (unit test with a failing read).
  - `GET /api/health/ops/<good token>` returns 200 with every check `ok` on a healthy system.
    It returns 503 naming `payment_callbacks` for the stalled fixture, and the overdue job names
    for an overdue fixture.
  - A wrong or missing token gets 404.
- **Sentry:** initialises only with a DSN. A thrown server error with an email and phone in its
  message reaches Sentry (once you've set the DSN) with both masked.
- **Logs:** the log-hygiene scan passes, and the five raw-error logs are fixed.
- **Restore rehearsal:** done, timed and recorded, with the temporary branch deleted.
- **Docs:** `docs/OPERATIONS.md` covers every section in requirement 9.
- **Checks:** `typecheck`, `lint`, `npm test`, `test:integration` and `build` pass. The sweep
  passes with the new rows.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration`
- `npm run build`, then the sweep:
  1. `UPSTASH_REDIS_REST_URL=http://127.0.0.1:9 UPSTASH_REDIS_REST_TOKEN=sweep OPS_HEALTH_TOKEN=<test value> npx next start -p 3005`
  2. `npm run security:sweep`
  3. `curl` the ops URL with the test token

## Manual test steps (after implementation)

1. **Generate the token.** Make a random `OPS_HEALTH_TOKEN` (I'll print a command that generates
   one without showing it).
   - Put it in `.env`, and in Vercel → Project → Environment Variables (Production).
2. **Sentry:**
   1. Create a free account at sentry.io and a **Next.js** project.
   2. Copy its DSN into Vercel as `NEXT_PUBLIC_SENTRY_DSN`. Optionally add it to `.env` too.
   3. In Sentry → Alerts, keep "Notify on new issues", sent to `mungaidenis45@gmail.com`.
3. **Deploy:** merge and push (I do this after your approval), then wait for "Ready".
4. **UptimeRobot:**
   1. Create a free account with `mungaidenis45@gmail.com`.
   2. Add two HTTP(s) monitors, every 5 minutes:
      - `https://verifiedpropertieske.vercel.app/api/health`
      - `https://verifiedpropertieske.vercel.app/api/health/ops/<your token>`
   3. Alert contact: your email.
   4. Both show "Up" within 5 minutes.
5. **Alert test:**
   1. In UptimeRobot, edit the ops monitor URL to end in `/wrong`. Within about 10 minutes you
      get a "Down" email.
   2. Change it back. A "Up" email follows.
6. **Sentry test:**
   1. With `NEXT_PUBLIC_SENTRY_DSN` in `.env`, run `npm run sentry:test`.
      - It's a local script (`scripts/sentry-test.ts`) that uses the same options and scrubber
        as the app.
      - It sends one error whose message contains a test email address and phone number.
      - There's no public route for this.
   2. Expect a Sentry email for a new issue. In Sentry, the message shows both masked.
7. **Neon protection:** Neon console → project → Branches → `production` → **Protect**.
8. **Runbook:** read `docs/OPERATIONS.md` and check the runbooks match how you want to work.

## Amendments during implementation

1. **Sentry setup (requirement 1, checked against the installed `@sentry/nextjs@10.77.1` types):**
   - `withSentryConfig` is imported from `@sentry/nextjs/config`; importing it from `@sentry/nextjs`
     prints a deprecation notice (removed in v11).
   - Options used exist as planned: `silent`, `telemetry: false`, `authToken`, and
     `sourcemaps.disable` (true unless `SENTRY_AUTH_TOKEN` is set). With Turbopack, uploads run
     after the build (`useRunAfterProductionCompileHook` defaults to true), so nothing is uploaded
     without a token.
   - The server, edge and browser inits share one options module (`sentry-options.ts`) instead of
     Sentry's suggested `sentry.server.config.ts` / `sentry.edge.config.ts` files. Same effect.
   - `src/app/global-error.tsx` added so a root-layout failure is reported too.
2. **Log fixes (decision 5):** provider failures are logged through a new `providerCode()`
   (`src/lib/monitoring/log-safe.ts`): the leading code only, e.g. `400 400.002.02` or `HTTP 401`.
   The full provider string stays in `payment_events`. Six call sites, not five: Daraja's
   `pushed.error` in `start-payment.ts` was included after checking it.
3. **Restore rehearsal (decision 6): not yet run.** The Neon connector needed authorisation in the
   implementing session, and no other Neon API access was available. The runbook records it as
   pending, with the procedure, and no timings were made up.
