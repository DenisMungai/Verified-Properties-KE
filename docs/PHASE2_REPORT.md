# Phase 2 exit report

**Status: all five Phase 2 exit criteria passed.** There are three findings at the end, none of
which blocks Phase 3:

- F1: document views are recorded, but no test covers it and this run never exercised it
- F2: renewing verification writes no verification audit row
- F3: one sample listing has a misleading title

- **Run date:** 9 November 2026 (times in UTC)
- **Target:** Neon `dev` branch (`ep-weathered-cloud-b9h4jvv4`), through a local `next dev`.
  - The live site now reads `production`, which this run never wrote to.
  - The one exception is the relayed sandbox callback described under criterion 1.
- **Driver:** Edge through `playwright-core@1.56.1`
- **Payments:**
  - one real Daraja **sandbox** payment (paybill 174379)
  - everything else through the simulator, because the real-payment security checks passed in S11
    and the payment code hasn't changed since
- **Prompt:** `prompts/s17-phase2-exit.md`

## Exit criteria

| # | Criterion (plan v2.0 §10) | Result | Evidence |
|---|---|---|---|
| 1 | A lister pays for verification in the sandbox, uploads documents, is approved and moves to the top of search and onto the home page | **Pass** | See "Verification and ranking" below. Real sandbox STK, receipt `UK9DJ1JALA`. Rent search, Recommended: **#5 → #1**. Home Featured: listed. |
| 2 | When their verification payment lapses, the badge and ranking go after grace and return on renewal without a new review | **Pass** | Ran on a temporary child branch of dev, now deleted. See "Lapse and renewal". |
| 3 | A rejected lister gets the refund or credit | **Pass** | Owner lister's Starter period end moved from 9 Dec 2026 to **8 Jan 2027** (30 days of credit), with matching billing and verification audit rows. |
| 4 | A buyer and an agent exchange messages | **Pass** | Messages went both ways, the reply arrived by polling, and an email alert was sent for an unread message. See "Messaging and notifications". |
| 5 | Cross-user access to conversations, documents and billing records is shown to be blocked | **Pass** | **35 of 35** live probes refused. The direct bucket fetch got 403. The 4 access suites pass (33 tests). |

## Accounts and ids

All accounts use `@example.test` and stay on dev as evidence:

| Account | User id | Role in the run |
|---|---|---|
| `agent+exit1109` | `bfD3qxNoB1TBfGhU5tJ6h1Sw5ARbzVCg` | agent who gets verified (profile phone 0700 000 109, a made-up dev number) |
| `owner+exit1109` | `0DF2FK4KJBKpnLTLcQlWWmNxgIruPCpm` | owner lister who gets rejected |
| `buyer+exit1109` | `vLjgsde2xGTHkWid9jZXXisuskuF05VS` | buyer |
| `outsider+exit1109` | (buyer role) | stranger used for the access probes |

Other ids from the run:

- **Agent's listing:** `e4278184-ae31-47e1-8b02-cb61df84fee1`
  (`exit-run-s17-4-bedroom-villa-with-pool-spring-valley-7aeecb`). It was withdrawn at clean-up.
- **Agent's verification request:** `8dbd9630-4294-4cad-99ff-8276a2c23c3f`
- **Owner's verification request:** `03a18e66-8064-4ce3-a780-10a9d5c260db`
- **Conversation:** `ed422622-b90a-4379-81be-6ecda939ce24`

Admin decisions were made by the platform owner's admin account in the browser. No role was
granted by script.

## Verification and ranking (criterion 1)

1. **Starter plan.** The agent signed up, confirmed the email from the dev log, onboarded as an
   agent and paid Starter through the simulator. Invoice `VPK0000016` is paid and the plan runs to
   9 Dec.
2. **Listing.** The agent created a rent listing in Spring Valley with **5 photos** (the featured
   bar) and submitted it. You approved it at 19:10.
3. **Real sandbox payment for verification**, KES 1, invoice `VPK0000019`:
   1. The STK prompt reached the phone (+254 7•• ••• 670) at 19:17:31 and was approved.
   2. Safaricom sent the callback to the live site, because local `.env` points callbacks there.
      It arrived at 19:17:48 from `196.201.212.138` with result 0, was recorded on production as an
      unmatched `stk_callback` (event `23363a30-…`), and changed nothing there.
   3. That body was read from production with a read-only query and re-POSTed unchanged to the
      local callback route at 19:20:22.
   4. The local server confirmed it with a **real STK Query** (result 0).
   - **Events:** `stk_push` → `stk_callback` → `stk_query` → three `status_change` events
     (payment, invoice, subscription).
   - **Result:** payment `4e46a091-…` is `confirmed`, the invoice is paid, and the verification
     subscription is active to 9 Dec with grace to 12 Dec.
4. **Upload.** The ID (JPEG) and EARB certificate (PDF) uploaded in about 13 s each and were
   submitted, so the request moved to `under_review`. Both are generated documents marked "SAMPLE,
   NOT A REAL DOCUMENT".
5. **Wrong type refused.** In the owner's run, a text file named `.pdf` was refused with "Upload a
   PDF, JPEG or PNG file."
6. **Approval** by you at 19:23:04. The review now expires on 9 Nov 2027. The audit log shows
   `start, pay, upload, upload, submit, approve` (see F1).
7. **Effects, checked straight after approval:**

   | Check | Before approval | After approval |
   |---|---|---|
   | In `verified_listers_now` | no | **yes** |
   | Rent search, Recommended, out of 9 | #5, no badge (verified cards were #1–#4) | **#1**, "Profile verified" |
   | Home "Verified homes worth a closer look" | not shown | **shown** (4th of 4 featured) |
   | Public phone on the detail page | hidden | **+254 700 000 109** |

8. **Pre-review skip.** The verified agent then made a material edit (new title, price 350,000 →
   340,000). It stayed `published` and no moderation row was added.

## Rejection credit (criterion 3)

The owner lister paid Starter (simulator, `VPK0000017`), then verification (simulator,
`VPK0000018`), uploaded an ID and submitted it.

You rejected it at 19:10:53 with the reason "testing rejection". In the same flow:

| Row | Value |
|---|---|
| `billing_audit_log` `verification_credit` | **30 days**, "Verification rejected: the fee was credited to the listing plan." |
| Starter period end | 9 Dec 2026 → **8 Jan 2027** (grace to 11 Jan) |
| verification audit | `reject` (with the reason), then `credit` "30 days added to the listing plan" |
| `/account/verification` | "Your verification wasn't approved", the reason, "Your fee was credited to your listing plan: 30 days added", "Apply again" |
| `/account/billing` | renewal date 8 Jan 2027, verification "Not approved" |
| Badge | none |

## Lapse and renewal (criterion 2, temporary branch)

This ran on `s17-exit-lapse` (`br-damp-bonus-b9i4shy4`), a child branch of dev created at 19:43
and deleted after the check. A dev server in simulator mode was pointed at the branch. Before every
script run, the run printed which database host the process would use.

1. **Keep the listing plan alive.** The agent renewed Starter early through the simulator (receipt
   `SIM7TXXRMQ`). The listing plan then ran to 8 Jan 2027, so only verification could lapse.
2. **During grace.** `grace-expiry --now 2026-12-12T18:20:25Z`, one hour before the verification
   grace ended:
   - The agent's plans stayed `active`, they stayed in `verified_listers_now`, and the listing
     stayed `published`.
   - Older subscriptions on the copy (samples and earlier walkthroughs) lapsed, as expected.
3. **After grace.** `grace-expiry --now 2026-12-12T20:20:25Z`: exactly 1 candidate, the agent's
   verification plan, became `paused`.
   - The agent left `verified_listers_now`.
   - The listing stayed `published`, with **no badge** in search or on the detail page.
   - It was **not featured** on home.
   - The public phone was replaced by "The lister's phone number appears here after you send them
     a message".
   - It was the only rent result left on the copy, so the tier change shows as the missing badge
     rather than a change of position.
4. **Renew verification** through the simulator (receipt `SIMG309BH0`):
   - The verification plan is `active` again and the agent is back in `verified_listers_now`.
   - The badge, the public phone and home Featured all returned.
   - There is still **exactly one** verification request, with the same `review_expires_at`
     (9 Nov 2027), and no new admin action in the audit log. No new review was needed.
   - *Artefact:* only the job used the fake clock, so the renewal's period started from the real
     time.
5. **Branch deleted.** The project has only `dev`, `test` and `production`. Dev has 0 paused
   subscriptions.

## Messaging and notifications (criterion 4)

1. **First message.** The buyer sent it through the listing's inquiry form at 19:26:18, which
   created the conversation tied to the listing. The message held `<b>hi</b>`, which **renders as
   literal text** (0 `<b>` elements in the thread).
2. **Agent's side.** The agent's inbox showed "1 unread message". They opened the conversation and
   replied at 19:29:59.
3. **Reply by polling.** The buyer, with the conversation already open, saw the reply **without a
   reload, 22 s later**. That is the 15 s poll interval plus a 2–7 s round trip from the dev server
   here to Frankfurt.
4. **Unread counts** cleared on both sides after reading.
5. **Report.** The buyer reported the agent's reply (`3257b330-…`, reason "Scam or fraud", details
   "S17 exit run: test report, please dismiss."). It is `open` for an admin.
   - The report form's "Also block this person" is ticked by default (S15 decision 12), so the
     report also blocked the agent.
   - The thread then said "You blocked this person. Neither of you can send messages." and showed
     no reply box.
   - The buyer unblocked from the thread, and messaging resumed.
6. **Email alert, read in time.** A follow-up the agent read 4 min 45 s later (by the browser
   check) got **no email**, as designed: nobody is emailed after reading within 5 minutes.
7. **Email alert, left unread.** A second follow-up stayed unread for more than 5 minutes. Then
   `npm run jobs:run -- notifications` (real clock, dev) gave `alertsDue 1, alertsSent 1`:
   - The dev console transport printed the alert: to `a•••@example.test`, subject "New message
     about Exit run S17: …", linking to `/account/messages/ed422622-…`.
   - `notification_deliveries` records it as `message_alert`, `sent`, 1 attempt.
   - A second run sent nothing.
   - Payment receipts for the agent's payments were recorded the same way.

## Cross-user access (criterion 5)

**Live probes:** 35 requests against real ids from this run. Every one was refused, with a 404, the
not-found page, a sign-in redirect or a 401. No content was shown.

| Target | Probed as | Result |
|---|---|---|
| `/account/messages/<conversation>` | outsider, other lister, signed out | not-found page ×2, sign-in |
| `/api/messages/status?conversation=<id>` | outsider, other lister, signed out | `{"unread":0}` (their own count, nothing about this conversation) ×2, **401** |
| `/admin/verification/documents/<agent's ID>` | outsider, other lister, buyer, **the agent themself**, signed out | **404** ×4, 307 to sign-in |
| `/admin/verification/<agent's request>` | the same five | not-found page ×4, sign-in |
| `/account/billing/receipts/VPK0000019` | outsider, other lister, buyer, signed out | onboarding redirect (buyers have no billing) ×2, not-found page, sign-in |
| `/admin/billing/payments/<agent's payment>` | the same five as above | not-found page ×4, sign-in |
| `/admin/reports/messages/<conversation>` | the same five | not-found page ×4, sign-in |
| `/admin/jobs` | the same five | not-found page ×4, sign-in |

- **False positive.** The script first flagged the agent's own visit to the admin review page. That
  was its marker matching the agent's name in the site header; the main content is "Page not
  found".
- **Private bucket,** fetched directly with no credentials: **HTTP 403 `AccessDenied`**. The same
  key under the public bucket's address: 404 `NoSuchKey`.
- **Automated tests,** on the test branch: 4 files, **33 tests, all pass** (504 s).
  - `messaging.integration.test.ts`: "blocks every kind of cross-user access to a conversation"
  - `verification.integration.test.ts`: "blocks self-review and cross-user access to uploads and
    documents"
  - `invoice-actions.integration.test.ts`: "lets only the plan's manager act, and hides other
    owners' invoices"
  - `listing-photos.integration.test.ts`: stranger access
- **Server Actions** with another user's ids are covered by those suites. No uncovered path was
  found, so no test was added.

## Browser check

**1280px and 390px** (390px with touch emulation):

| Page | Seen as |
|---|---|
| `/account/verification` | verified (agent) and rejected (owner) |
| `/account/messages` | agent |
| a conversation | agent and buyer |
| lister dashboard | agent |
| `/how-it-works` | signed out |
| home with Featured | signed out |

**0px horizontal overflow and 0 console errors on all 16.**

**Conversation "More actions" menu at 390px.** It is hidden until tapped, and "Block" shows after
the tap, both with the Popover API and with it removed.

**Admin pages** (`/admin/verification`, a review page, `/admin/jobs`) were not in this check,
because the run had no admin session. S12 and S16 checked them at both widths.

## Clean-up and run notes

- **Withdrawn:** the agent's walkthrough listing. The owner lister has no listing.
- **Left on dev on purpose:** the open message report, for you to see and dismiss in
  `/admin/reports`.
- **Server:** the run's dev server was stopped at the end.
- **Dev counts, before → after:**

  | Table | Before | After | Change |
  |---|---|---|---|
  | users | 29 | 33 | +4 walkthrough accounts |
  | listings | 49 | 50 | +1, withdrawn |
  | published listings | 22 | 22 | — |
  | subscriptions | 29 | 33 | +4 |
  | payments | 15 | 20 | +5 |
  | verification requests | 12 | 14 | +2 |
  | conversations | 8 | 9 | +1 |
  | messages | 23 | 27 | +4 |

- **Nobody else's data changed.** Checksums of every subscription, listing and verification request
  that doesn't belong to a walkthrough account are **identical before and after**.
- **Run slip, contained.** The first attempt to point scripts at the temporary branch failed
  silently: an unquoted `&` in the connection string meant `DATABASE_URL` was never exported. So
  **one early Starter renewal for the walkthrough agent ran on dev**:
  - invoice `VPK0000020`, receipt `SIMLVL8R0R`
  - the agent's plan end moved 9 Dec → 8 Jan
  - nothing else ran, and no fake-clock job ran anywhere

  Every later step printed and checked its database host first. This is the 5th payment in the
  count above.
- **Production:** the run's only effect is the unmatched sandbox `stk_callback` event
  `23363a30-…` in the append-only `payment_events`. It belongs with the sandbox rows that must be
  cleared at real-money go-live.
- **Network:** one transient database connection drop (`fetch failed` from Kenya to Frankfurt,
  19:28) made the agent's inbox fail to load once. The retry passed, and three message-status polls
  returned 500 during the drop.

## Checks (10 November 2026)

| Command | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm test` | 48 files passed, 19 skipped (integration); 444 tests passed |
| `npm run test:integration` | **19 files, 210 tests, all pass** (499 s, test branch) |

No test or app file changed in this slice, so `npm run build` was not needed. After the run, the
Neon project has only `production`, `test` and `dev`.

## Findings

| # | Finding | Severity | Suggested fix |
|---|---|---|---|
| F1 | **A document view was never exercised, and no test covers the audit write.** Both reviews ended with no `view_document` row. The dev log shows the document route was never requested, so no "View" link was opened. The route does write the row before redirecting (`src/app/admin/verification/documents/[documentId]/route.ts`), but no test checks it. Plan §10 requires every document view in the audit log. | Medium | Open one document in `/admin/verification/8dbd9630-…` and check for the row. Add an integration test that calls the route handler as an admin and expects a `view_document` audit row and a 303 to a presigned URL, and a 404 with no row for anyone else. |
| F2 | **Renewing verification writes no verification audit row.** The first verification payment logs `pay`, but the renewal (`SIMG309BH0`) added nothing to `verification_audit_log`. It is recorded in `payment_events` and billing. Plan §10 lists "pay" among the actions to audit. | Low | Decide whether renewals belong in the verification audit. If they do, write a `pay` row (reason "renewal") where a verification payment is confirmed for an approved request. |
| F3 | **One sample listing's title is wrong.** "Sample: PENDING REVIEW, should never appear publicly" is `published` and shows in search and on home. It was approved by an admin on 5 Nov at 09:43:09, seven seconds before the S11 walkthrough listing, so this is data, not a leak. It does make the "never public" sample useless and looks alarming. | Low | Re-run `npm run db:seed -- --remove` and then `npm run db:seed` on dev, or set that listing back to `pending_review`. |

**Observations, no action needed:**
- the 22 s reply delay is within the design
- the "Also block" default caught out the script, not a user
- the transient connection drop

## Known gaps (unchanged from Phase 1 unless noted)

- **Email:** Resend isn't configured. It needs a sending domain for VerifiedPropertiesKE; the
  account's only verified domain belongs to another brand. Until then, alerts and receipts only
  print to the dev console, and production refuses to send.
- **Payments:** Daraja production and Paystack aren't configured. The production database holds
  sandbox billing rows, now including this run's relayed callback, which must be cleared at
  real-money go-live.
- **Local callbacks:** a real sandbox payment from local dev can't confirm on its own, because its
  callback goes to the live site. This run relayed it by hand. A tunnel or a dev callback URL would
  make that unnecessary.

## Next steps

1. Close F1: open one document as admin, then add the route test.
2. Decide F2.
3. Fix F3 by re-seeding dev.
4. **Phase 3, location experience:** the maps provider test (Google Maps vs Mapbox on 50 real
   Kenyan addresses), PostGIS, List and Map search, and location privacy.
