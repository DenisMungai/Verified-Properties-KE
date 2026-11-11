# VerifiedPropertiesKE operations runbook

What is watched, what each alert means, and what to do. Written in S21 (`prompts/s21-monitoring-ops.md`).

Live site: `https://verifiedpropertieske.vercel.app` (Vercel project `verified-properties-ke`, team
`45-creatives`, region `fra1`). Database: Neon project `falling-sky-58396938`, branch `production`
(`br-mute-star-b92vpkso`). A push to `main` deploys.

---

## 1. Monitors and alerts

| What | Tool | Checks | Alerts to |
| --- | --- | --- | --- |
| Site and database up | UptimeRobot, every 5 min | `GET /api/health` → `200 {"status":"ok"}`; `503 {"status":"down"}` when the database doesn't answer within 3 s | the owner's email, set in UptimeRobot |
| Jobs and payment callbacks | UptimeRobot, every 5 min | `GET /api/health/ops/<OPS_HEALTH_TOKEN>` → `200` when every check passes, `503` naming the failing checks | the owner's email, set in UptimeRobot |
| Server and browser errors | Sentry (free plan) | New issues from `onRequestError`, the browser SDK and `global-error.tsx` | the owner's email, Sentry's "notify on new issues" rule |

The alert address lives only in UptimeRobot and Sentry settings, never in the repo.

**The ops checks** (`src/lib/monitoring/rules.ts`):

| Check | Fails when |
| --- | --- |
| `database` | The reads fail or take longer than 8 s. Every other check then reads `ok`, because it is unknown. |
| `jobs_overdue` | A job that has run before has no finished (`ok` or `skipped`) run in twice its interval. The body lists `overdueJobs`. |
| `jobs_failing` | A job's latest run has status `failed`. The body lists `failingJobs`. |
| `payment_callbacks` | Of the STK pushes recorded between 2 hours and 15 minutes ago, at least 2, **and** at least half, have no `stk_callback` event. Fewer than 2 pushes always passes: no traffic is not an outage. |

Job intervals (`src/lib/jobs/schedules.ts`): `notifications` 5 min, `payment-checks` 15 min,
`grace-expiry` and `plan-changes` hourly, the other five daily. So `notifications` is overdue after
10 minutes without a finished run, and a daily job after 48 hours.

**Pause alerts** (planned maintenance, a known outage you are already handling): UptimeRobot →
the monitor → **Pause**; resume afterwards. In Sentry, **Ignore** or **Mute** the issue
(for a time, or until it happens N more times). Don't delete monitors to silence them.

---

## 2. Alert runbooks

Start every incident by writing down the time the alert arrived. Fill in an incident note
(section 6) once it's over.

### Site down (`/api/health` is Down)

1. Open the site. If Vercel shows its own error page, check [vercel-status.com](https://www.vercel-status.com)
   and Vercel → Project → Deployments: is the latest deployment **Ready**?
2. A deploy just went out → **roll back** (section 3) first, then investigate.
3. Otherwise the database: Neon console → project → `production` branch → **Monitoring**. Is the
   compute active? Check [neonstatus.com](https://neonstatus.com). A suspended compute wakes on
   the next query; a Neon incident means waiting.
4. Vercel → Project → Logs, filter `/api/health`, for the error *name* (bodies never carry it).
5. If `DATABASE_URL` was rotated or changed, confirm the Vercel value matches the Neon
   connection string for `production` (pooled), then redeploy from Git (not "Redeploy", which
   keeps the old env values).

### `jobs_overdue`

Jobs are run by Upstash QStash schedules calling `POST /api/jobs/<job>`.

1. Admin → **Jobs & emails** (`/admin/jobs`): which job, when it last finished.
2. Upstash console → QStash → **Schedules**: the `vpk-<job>` schedule exists and is not paused.
   **Logs / DLQ**: are deliveries failing (401/403 = signing keys; 5xx = the route; timeouts)?
3. Signing keys rotated? `QSTASH_CURRENT_SIGNING_KEY` / `QSTASH_NEXT_SIGNING_KEY` in Vercel must
   match the console. Redeploy from Git after changing them.
4. Schedules missing (new QStash account or region): `npm run jobs:schedule -- https://verifiedpropertieske.vercel.app`
   with `QSTASH_TOKEN` in `.env.local`.
5. QStash free plan: about 440 deliveries a day against 1,000. If the quota ran out, deliveries
   stop until the next day; upgrade or reduce frequency.
6. To catch up by hand: `npm run jobs:run -- <job>` runs it against the database in `.env`
   (local dev, **not** production). For production, trigger the schedule from the QStash console.

### `jobs_failing`

1. Admin → **Jobs & emails** → **Failed runs (last 7 days)**: the job, time and summary.
2. Vercel → Logs, filter `[jobs] <job>`: the failing step and error name.
3. Sentry: a matching issue usually has the stack trace.
4. Fix forward or roll back (section 3). The next scheduled run clears the alert once it
   finishes `ok`.
5. `payment-checks` or `grace-expiry` failing affects billing: check flagged payments and lapsed
   subscriptions the same day.

### `payment_callbacks`

M-Pesa STK callbacks are not arriving. No money is lost: `payment-checks` settles pending STK
payments with the STK Query API, and the nightly `reconciliation` job follows up. But buyers wait
longer for confirmation, so act within the hour.

1. **Daraja status:** Safaricom developer portal / status announcements. A Daraja outage clears on
   its own; nothing to change.
2. **Callback URL and token:** the registered callback is
   `https://verifiedpropertieske.vercel.app/api/payments/stk/<MPESA_CALLBACK_TOKEN>`. If
   `MPESA_CALLBACK_TOKEN` or `NEXT_PUBLIC_APP_URL` / `MPESA_CALLBACK_BASE_URL` changed, the token
   in the URL sent with each push changed too; pushes after the change carry the new URL.
3. **IP allowlist:** Vercel → Logs, filter `/api/payments/stk`: **403** means Safaricom called from
   an address outside `MPESA_CALLBACK_ALLOWED_IPS`. Compare against Safaricom's published ranges
   and update the variable (then redeploy from Git). **404** means a wrong token.
4. **Recorded but rejected:** `payment_events` rows of type `callback_rejected` show the reason
   (admin → Billing → payments, or a read-only query).
5. Check `payment-checks` is running (it settles the stuck payments meanwhile).

### New Sentry issue

1. Open the issue: route, release, how many users, first and last seen.
2. Messages are scrubbed: emails show as `j•••@example.com`, phones as `+254 7•• ••• 678`, long
   tokens as `•••`. Request bodies, cookies, headers, query strings and users are never sent.
3. One-off from a bot or old browser → **Ignore**. Regression from the latest deploy → roll back
   (section 3). Otherwise open a fix.
4. Resolve the issue when the fix is deployed; Sentry reopens it if it comes back.

### Flagged payments

Not an UptimeRobot alert: check admin → **Billing** → **Flagged payments** after any payment
alert, and weekly.

1. A flagged payment was paid but **not** activated (amount mismatch, unknown invoice, duplicate).
2. Compare the M-Pesa receipt with the invoice amount (the M-Pesa statement or Daraja portal).
3. Resolve it in admin billing; every action is written to `billing_audit_log`.

---

## 3. Roll back a bad deploy

**Fastest (no code change):** Vercel → Project → **Deployments** → the previous deployment marked
**Ready** → **⋯** → **Promote to Production**. The live site switches in seconds. The next push to
`main` deploys normally again, so fix forward before pushing.

**Through Git:** `git revert <bad commit>` on `main`, push, wait for **Ready**.

**Database migrations don't roll back with the code.** Every migration so far is additive, so the
previous deployment runs against the newer schema. If a future migration is destructive, write its
rollback note in the slice prompt before applying it.

---

## 4. Restore from backup

Two kinds of backup exist:

- **History (point in time):** any moment in the last **6 hours** (project history retention,
  21,600 s on the free plan; Neon console → project → **Settings**).
- **Snapshots:** the free plan keeps **one** manual snapshot. Today that is
  `production-manual-2026-11-10` (taken 2026-11-10 18:33 UTC). Replace it after big changes:
  delete the old one, then take a new one.

**Rehearsal record** (2026-11-11, S21):

| Item | Value |
| --- | --- |
| Restore window | 6 hours of history, plus the one manual snapshot |
| Source | Snapshot `production-manual-2026-11-10` (production as of 2026-11-10 18:33 UTC). A point-in-time snapshot couldn't be taken because the free plan's one snapshot slot was in use |
| Time from request to queryable branch | **13 seconds** (requested 07:48:39 UTC, first query answered 07:48:52) |
| Row counts compared | `users` 1, `properties` 1, `property_images` 13, `subscriptions` 1, `invoices` 2, `payments` 2, `verification_requests` 0, `messages` 0, `data_requests` 0: identical. `payment_events` 18 vs 19 and `job_runs` 902 vs 1145: exactly the 1 `reconciliation` event and 243 job runs recorded after the snapshot |
| Problem found | The restore was **finalized** (the tool's default for a new branch). Neon swapped the restored copy in as `production` for about 3 minutes. See the incident note `docs/incidents/2026-11-11-restore-rehearsal-swap.md`. Put back by hand; no data lost except one job-run log row |
| Rehearsal branch deleted | Yes, after production was put back |

### Rehearse (production is never written)

**Always restore unfinalized.** A finalized restore moves production's compute onto the restored
copy and renames the branches, so the live site runs on the backup. In the Neon console, choose
"restore to a new branch" and do **not** tick finalize / "replace"; with the CLI or API, pass
`finalize: false`.

1. Neon console → **Branches** → **Create branch**. Parent `production`, **Point in time** one
   hour ago (or restore the snapshot to a new branch, unfinalized), name `restore-rehearsal-<date>`,
   with its own compute. Note the time you click Create and the time the branch's SQL Editor first
   answers `select 1`.
2. Check **production is still default** and still has endpoint `ep-summer-morning-b9otl4v9`
   (Branches list). If not, stop and follow the incident note's fix.
3. In the SQL Editor, run the same row counts and latest timestamps on the rehearsal branch and on
   `production`. Every difference must be explained by activity since the restore point.
4. Delete the rehearsal branch. Record the results in the table above.

### Restore for real

1. **Stop writes:** pause the QStash schedules (Upstash → QStash → Schedules) so jobs don't write
   while you restore. Optionally promote a maintenance deploy.
2. **Choose the point in time** just before the damage (Neon → `production` → **Monitoring** /
   your incident timeline).
3. **Preferred: restore `production` in place.** Neon → Branches → `production` → **Restore** →
   point in time. Neon keeps the pre-restore state as a backup branch. The connection string and
   endpoint stay the same, so Vercel needs no change.
   - **Photos stay on the old branch.** Storage buckets belong to the branch *id*
     (`br-mute-star-b92vpkso`), and Vercel's `STORAGE_*` values name that id. The rehearsal's
     restored branch had no buckets. After a finalized restore the old branch is renamed (e.g.
     `production (old)`) but still holds every photo: **don't delete it**. Photos keep loading
     because Vercel still points at it.
4. **Alternative: restore to a new branch** and point the app at it: create a branch from the point
   in time, then in Vercel set `DATABASE_URL` (pooled), and the `STORAGE_*` endpoint if photos
   should come from that branch, to the new branch's values. Redeploy **from Git** (Vercel's
   "Redeploy" keeps the old env values).
5. Resume the QStash schedules. Payments made between the restore point and now exist at
   Safaricom but not in the database: run `reconciliation`, then check M-Pesa statements for
   receipts with no `payments` row and record them in admin billing.
6. Write the incident note.

**Protected branches** would block accidental deletes and resets, but the free plan allows none
(checked 2026-11-11: "maximum number of protected branches for your current plan"). Turn it on
for `production` if the plan is upgraded. Until then, never run delete or reset on
`br-mute-star-b92vpkso`: it is production, it holds the photo storage buckets, and `dev` and
`test` are its children.

---

## 5. Rotate a secret

General rule: change the value in Vercel → Project → Environment Variables (Production) and in your
local `.env.local` if you use it there, then **deploy from Git** (push a commit, or Deployments →
Create from `main`). "Redeploy" of an old deployment keeps its old values.

| Secret | Steps |
| --- | --- |
| `OPS_HEALTH_TOKEN` | Generate a new value (24+ random characters, e.g. `openssl rand -hex 24`). Set it in Vercel, deploy, then edit the UptimeRobot ops monitor URL to the new token. Between the deploy and the URL edit the monitor shows Down; pause it for those minutes. |
| `MPESA_CALLBACK_TOKEN` | New value in Vercel, deploy. Each STK push sends its callback URL, so new pushes use the new token at once. Pushes started before the deploy call the old URL and get 404; `payment-checks` settles them by STK Query. For C2B Paybill, re-register the URLs: `MPESA_REGISTER_CONFIRM=yes npm run mpesa:register-c2b` with production settings. |
| Database password | Neon → project → **Roles** → `neondb_owner` → **Reset password**. Update `DATABASE_URL` (pooled) in Vercel and your local `PROD_DATABASE_URL_UNPOOLED`, deploy. The site is down between the reset and the deploy: do it at a quiet time. |
| Sentry DSN | Sentry → Project settings → **Client Keys** → create a new key, set `NEXT_PUBLIC_SENTRY_DSN` in Vercel, deploy, then disable the old key. (A DSN can only send events; rotate it if it's being abused for spam.) |
| Upstash Redis | Upstash → the database → **Reset password/token**. Update `UPSTASH_REDIS_REST_TOKEN` in Vercel, deploy. Until the deploy, the old token is refused and the app's rate limits fail open (logged as `[rate-limit] provider error`; Better Auth's own limiter still applies), so deploy straight away. If the variable is *removed*, production refuses rate-limited actions instead. |
| QStash | Upstash → QStash → **Roll signing keys**: set the new `QSTASH_CURRENT_SIGNING_KEY` and `QSTASH_NEXT_SIGNING_KEY` in Vercel, deploy. Rotating `QSTASH_TOKEN` only affects `npm run jobs:schedule`. |
| `BETTER_AUTH_SECRET` | New value, deploy. Signs everyone out; email links in flight stop working. |

Never paste a secret into a chat, issue or commit. `.env` and `.env.local` are gitignored.

---

## 6. Incident note template

Keep notes in `docs/incidents/YYYY-MM-DD-short-name.md`.

```markdown
# <short name>

- **What:** what users saw
- **When:** alert time, start, end (Africa/Nairobi)
- **Impact:** who and how many; payments or listings affected
- **Cause:** what actually broke
- **Fix:** what was done, and by whom
- **Follow-ups:** changes to make this less likely or quicker to fix, with owners
```

---

## 7. Not monitored yet

- **Email delivery.** Resend has no domain for this site yet. Once it does, add Resend's bounce and
  complaint webhooks or alerts.
- **Daraja production.** Callbacks are watched, but against the sandbox. At go-live (S23) re-check
  the `payment_callbacks` thresholds against real traffic, and clear the sandbox billing rows.
- **Performance.** Sentry tracing is off. Use Vercel Analytics / Speed Insights if needed.
- **Paging.** Alerts are email only.
