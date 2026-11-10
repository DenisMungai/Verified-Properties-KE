# S17 — Phase 2 exit run

## Goal

Close Phase 2 by showing, with recorded evidence, that every Phase 2 exit criterion holds. The
evidence goes in `docs/PHASE2_REPORT.md`. Like S11, this slice is a walkthrough plus a report, not
new features.

> **Exit criteria (plan v2.0 §10):** a lister pays for verification in the sandbox, uploads
> documents, is approved and moves to the top of search and onto the home page. When their
> verification payment lapses, the badge and ranking go after grace and return on renewal without
> a new review. A rejected lister gets the refund or credit. A buyer and an agent exchange
> messages. Cross-user access to conversations, documents and billing records is shown to be
> blocked.

## References read

- `AGENTS.md`:
  - §6: derived badge, ranking, lapse with 3-day grace, contact rules
  - §8: security
  - §9: commands; no destructive tests or real payments against production
- `docs/implementation-plan-v2.md`:
  - §10: Phase 2 tasks and exit criteria
  - §14: testing on a dedicated branch, Daraja sandbox
- `prompts/s11-seed-exit.md` and `docs/PHASE1_REPORT.md`: the exit-run format, the temporary-branch
  lapse method and the evidence style
- `prompts/s12-verification.md`:
  - documents depend on the lister type
  - a rejection credits the fee as days on the listing plan
  - renewing restores the badge without a new review
- `prompts/s13-verification-lifecycle.md`: re-review, expiry, retention
- `prompts/s14-featured-help.md`: featured needs verified, 5+ photos, 2 per lister
- `prompts/s15-messaging.md`, `prompts/s16-notifications.md`: email alerts 5 minutes after an
  unread message, `/admin/jobs`
- Memory:
  - Local `.env` points at the Neon `dev` branch. The live site now reads `production`, not dev.
  - Only one `next dev` can run per folder, and a simulator server needs empty `MPESA_*` creds.
  - Walkthroughs use Edge through `playwright-core@1.56.1` from the scratchpad.
  - Classifier limits: `admin:create`, `db:seed` and production writes are run by the user.
  - The user's phone has no Popover API.

## Existing code inspected

- **Callbacks:** `src/lib/mpesa/settle.ts` `recordStkCallback` stores every STK callback as an
  `stk_callback` event, even when its checkout id matches no payment. Confirmation needs the
  callback and STK Query to agree; the query alone only closes or flags. The route is
  `src/app/api/payments/stk/[token]/route.ts`.
- **Local env:** `MPESA_CALLBACK_BASE_URL` points at the live site, which now reads the
  **production** branch. A real sandbox STK started from local dev therefore sends its callback to
  production, where it is recorded as an unmatched `stk_callback` and nothing else happens.
- **Billing periods:** in `src/lib/billing/periods.ts`, `nextPeriod` starts at the later of now
  and the current period end, so an early renewal adds 30 days. `subscriptionPhase` gives active,
  then grace, then lapsed.
- **Lapse job:** `src/lib/jobs/grace-expiry.ts` pauses listing and verification subscriptions after
  grace. The `verified_listers_now` view only counts active or past_due subscriptions inside grace.
- **Verification rules:** `src/lib/verification/rules.ts` `requiredDocumentTypes`:
  - owner: ID only
  - agent: ID + EARB certificate
  - developer or agency member: ID + business registration

  `documents.ts` checks the file's real type (PDF, JPEG or PNG) by sniffing its bytes.
- **Home featured:** `src/db/queries/public-listings.ts` home showcase needs verified,
  `photo_count >= FEATURED_MIN_PHOTOS` (5) and a cover photo.
- **Notifications:** the job in `src/lib/jobs/notifications.ts` alerts after `ALERT_DELAY_MIN` (5)
  minutes.
- **Routes the access checks cover:**
  - `/account/messages/[id]`, `/api/messages/status`
  - `/account/verification`
  - `/admin/verification`, `/admin/verification/[id]`,
    `/admin/verification/documents/[documentId]`
  - `/account/billing/receipts/[invoiceNumber]`
  - `/admin/billing/payments/[id]`, `/admin/reports/messages/[id]`, `/admin/jobs`
- **Existing access tests:**
  - `messaging.integration.test.ts`: "blocks every kind of cross-user access to a conversation"
  - `verification.integration.test.ts`: "blocks self-review and cross-user access to uploads and
    documents"
  - `invoice-actions.integration.test.ts`: "hides other owners' invoices"
  - `listing-photos.integration.test.ts`: stranger access
- **Scripts:** `mpesa:pay`, `mpesa:simulate`, `mpesa:status`, and `jobs:run`, whose `--now` needs
  `JOBS_FAKE_CLOCK_CONFIRM=yes`.

## Decisions and assumptions

1. **Target: the Neon `dev` branch through a local `next dev`.** Production is never written to by
   this run. The one exception is the unmatched sandbox callback described in decision 3, which
   Safaricom delivers there anyway. Walkthrough accounts use `+exit1109@example.test` aliases and
   stay on dev as evidence:
   - `agent+exit1109`: the lister who gets verified
   - `owner+exit1109`: an owner lister who gets rejected
   - `buyer+exit1109`
   - `outsider+exit1109`: for the cross-user probes

2. **I run the dev server during the run.** Please stop your `npm run dev` on :3000 first. I
   restart it between two modes:
   - **Simulator mode** (empty `MPESA_CONSUMER_KEY/SECRET/PASSKEY`,
     `MPESA_CALLBACK_BASE_URL=http://localhost:3000`): used for every payment except one.
   - **Daraja sandbox mode** (your `.env` as it is): used for the agent's verification payment
     only.

   I give the server back to you at the end.

3. **One real sandbox payment: the agent's verification fee, with the callback relayed.** The real
   callback lands on production (see code inspected), so:
   1. I start a real STK Push from local dev to a phone number you give me, and you approve it.
   2. I read that `stk_callback` row from production with a read-only query (Neon `run_sql`, which
      worked before).
   3. I re-POST its exact body to the local callback route. Local dev has no IP allowlist, so it
      accepts the request.
   4. The local server confirms with a real STK Query, so the callback and the query must agree
      exactly as they would live.

   - **Leftover:** an unmatched sandbox `stk_callback` row stays in production's append-only
     `payment_events`. Production already holds sandbox billing rows that must be cleared at
     real-money go-live, and this is one more of the same kind. The report notes it.
   - **If the prompt doesn't arrive, or the relay doesn't confirm:** the step is finished with the
     simulator and the real-STK check is marked "owed", as S11 allowed.
   - **Why not more real payments:** the real STK, replay and forged-IP checks already passed in
     S11 and the payment code hasn't changed, so the other payments use the simulator.

4. **Admin decisions are yours, in the browser.** The auto-mode classifier blocks
   `admin:create`, so a throwaway admin isn't possible. When the run reaches a review, I'll ask
   you to open http://localhost:3000/admin/verification as your platform admin and do one of:
   - approve the agent's listing
   - view one document and approve the agent's verification
   - view the owner's document and reject it with the reason "SAMPLE: exit run rejection"

   I record the audit rows afterwards.

5. **"Moves to the top of search" is measured, not eyeballed.** Before approval I record the
   agent's listing position under Recommended for a query it matches, such as its neighbourhood
   with the right mode. After approval I record it again. Pass means the listing moves into the
   verified tier, above every unverified match. The S11 sample verified listers (Wanjiru and
   Otieno) are in that tier too, so "top" means the tier, not necessarily row 1. The report gives
   both positions and the tier boundary.

6. **Home page featured.** The agent's listing gets 5 photos so it meets the featured bar.
   - **Photos:** these are the S11 seed photos upscaled to 1200×1200 with sharp, into the
     scratchpad. Uploaded photos must be at least 800×600.
   - **Check:** after approval the listing appears in the home Featured section, alongside at most
     2 per lister.
   - **Rotation:** if the daily rotation leaves it out, I call the home showcase query and record
     that it is eligible, and the report says so.

7. **Pre-review skip.** After approval the agent makes a material edit to the published listing.
   It must stay `published`; it must not go to `pending_review`.

8. **Lapse and renewal run on a temporary child branch of dev (`s17-exit-lapse`)**, as in S11. A
   fake-clock `grace-expiry` pauses every subscription whose grace has ended by the fake time, so
   it must never run on dev itself. Approving this prompt approves creating and then deleting that
   one branch. On the branch, with a server in simulator mode pointed at it:
   1. **Keep the listing plan alive:** renew the agent's Starter plan early with
      `mpesa:pay` + `mpesa:simulate`. Its period end moves 30 days later, so the next steps lapse
      only verification.
   2. **During grace:** `jobs:run -- grace-expiry --now <verification grace end − 1 hour>`. The
      agent's verification subscription stays live, and they stay in `verified_listers_now`.
   3. **After grace:** `jobs:run -- grace-expiry --now <verification grace end + 1 hour>`. The
      verification subscription becomes `paused` and the agent leaves `verified_listers_now`. Their
      listing stays `published`, but:
      - it drops to the unverified tier in `searchListings` Recommended
      - it is no longer featured on home
      - the public detail shows no badge and no public phone
   4. **Renew verification:** pay the verification plan through the simulator. The badge, the
      verified tier and the public phone return, with these conditions:
      - no new `verification_requests` row
      - the same `review_expires_at`
      - no admin action

      This is the "returns on renewal without a new review" check.
   5. **Delete the branch.** I also confirm on dev that nothing was touched.

   **Artefacts:**
   - Only the job uses the fake clock. The view reads the database's real `now()`, which is why
     the lapse is shown through the subscription status the job sets.
   - Photos are checked only by status, because storage buckets are branch-scoped.

9. **Rejection credit.** The owner lister pays Starter, then verification (simulator), uploads an
   ID and is rejected. Pass means all of:
   - their Starter period end moves later by `creditDaysFromPayment(...)` days
   - one `billing_audit_log` `credit` row and one verification audit `credit` row
   - the rejection reason and the credit shown on `/account/verification`
   - no badge

10. **Messaging.**
    1. The buyer opens the agent's listing and sends a message, which creates a conversation tied
       to the listing.
    2. The agent sees the inbox unread count, opens it and replies.
    3. The buyer sees the reply arrive through polling, without a reload, within about 15 seconds.
    4. Both see the unread counts clear.

    - **Plain text:** one message holds `<b>hi</b>` and must render as text.
    - **Email alert:** a buyer message left unread for more than 5 minutes, then
      `npm run jobs:run -- notifications` (real clock, on dev). The dev console transport logs the
      alert with a link to the signed-in conversation. `notification_deliveries` records it as
      sent, and `/admin/jobs` shows the run.
    - **Report:** the buyer reports one of the agent's messages, and it appears in
      `/admin/reports` for you.

11. **Cross-user access is shown twice: by the existing tests and by live probes.**
    - **Tests:** the four integration suites listed under "Existing code inspected" run and pass.
    - **Live probes:** each runs as each of these, against real ids from this run:
      - `outsider` (a signed-in buyer, a stranger to everything)
      - the other lister
      - signed out
    - **Expected result for each probe:** not found, a sign-in redirect, or 403. Never content.

    | Probe | Target |
    |---|---|
    | Conversation page | `/account/messages/<buyer–agent conversation id>` |
    | Message polling | `/api/messages/status` for that conversation |
    | Verification document | `/admin/verification/documents/<agent's document id>` |
    | Verification review | `/admin/verification/<agent's request id>` |
    | Document object | the document's private bucket URL, fetched directly (expect AccessDenied) |
    | Receipt | `/account/billing/receipts/<agent's invoice number>` |
    | Admin payment | `/admin/billing/payments/<agent's payment id>` |
    | Admin pages | `/admin/reports/messages/<id>`, `/admin/jobs` |

    - **Server Actions:** any Server Action the probe can reach is also called with another
      user's id, using the action id from the page, wherever the existing tests don't already
      cover it.
    - **Gaps:** if a probe finds a path with no automated test, I add a test only, with no app
      change, and flag it to you.

12. **Out of scope:**
    - new features or UI
    - Playwright as a project dependency
    - fixing what the run finds

    Failures go in the report as numbered findings with a suggested fix, and I raise them with
    you before any code change (like `s11-exit-fixes`).

## Files likely to change

- `docs/PHASE2_REPORT.md` (new)
- Only if decision 11 finds an untested path: one added case in the matching
  `*.integration.test.ts`
- No app code, schema or migration changes. Scratch scripts and screenshots stay in the
  scratchpad.

## Implementation requirements

The exit run, in this order. Every step records evidence: ids, UTC timestamps, the relevant
`payment_events`, verification audit and billing audit rows, and scratchpad screenshots.

1. **Pre-flight.**
   - **Dev state:** record dev row counts for users, listings, subscriptions, payments,
     verification requests, conversations and messages. Confirm the S11 samples are still seeded,
     with Wanjiru and Otieno in `verified_listers_now`.
   - **Your accounts:** record the state of your own dev accounts so the end can show they're
     untouched.
   - **Checks:** run `typecheck`, `lint` and `npm test`.
2. **Agent:**
   1. Sign up and confirm the email from the dev log.
   2. Choose an agent profile with a phone number.
   3. Pay Starter (simulator).
   4. Create a listing with 5 photos and submit it. It is `pending_review`.
   5. You approve it (decision 4).
   6. Record its search position and confirm it isn't featured.
3. **Verification purchase (decision 3):** a real sandbox STK for the verification plan, then the
   relay and local STK Query confirmation. The verification subscription is active and the request
   moves to the upload step.
4. **Upload:**
   - **Documents:** a generated ID image and a generated EARB PDF (both labelled SAMPLE), then
     submit. The request is `under_review`.
   - **Wrong type:** a file with the wrong real type, such as a `.pdf` that is really text, is
     rejected with the user-facing message.
5. **Approval** (you, decision 4). Then confirm:
   - `verified_listers_now` includes the agent
   - the badge reads "Profile verified" on the card and the detail page
   - the public phone appears on the detail page
   - the search position is now in the verified tier (decision 5)
   - the listing is featured on home (decision 6)
   - the material edit stays published (decision 7)
   - the audit log holds submit, pay, view-document and approve rows
6. **Owner rejection:** decision 9.
7. **Messaging:** decision 10.
8. **Lapse and renewal on the temporary branch:** decision 8.
9. **Cross-user access:** decision 11.
10. **Browser check** at 1280px and 390px, with no horizontal overflow and no console errors, on:
    - `/account/verification` (each state seen)
    - `/account/messages` and a conversation
    - `/admin/verification` and a review page
    - `/admin/jobs`
    - `/how-it-works`
    - home with Featured

    At 390px, repeat any popover or sheet with the Popover API removed.
11. **Clean up:**
    - withdraw the agent's and the owner's walkthrough listings
    - delete the temporary branch
    - stop my server
    - compare dev counts with pre-flight, so only walkthrough rows were added
12. **Report: `docs/PHASE2_REPORT.md`**
    - an exit-criteria table: pass, fail or owed, with evidence
    - sections for:
      - verification and ranking
      - lapse and renewal (temporary branch)
      - rejection credit
      - messaging and notifications
      - cross-user access (tests and probes)
      - browser check
      - clean-up
    - findings
    - known gaps:
      - Resend needs its own domain
      - Daraja production and Paystack aren't configured
      - production sandbox rows must be cleared at go-live, now including the relayed callback
    - next steps for Phase 3

## Security requirements

- **Production:**
  - Production is read only: one `select` for the relayed callback body.
  - No writes, no fake clock and no walkthrough accounts there.
  - The fake clock runs only on the temporary branch, which is deleted afterwards.
- **Personal data:**
  - Generated documents are obvious samples with no real person's details.
  - Phone numbers are masked in the report and the logs.
  - Secrets are never printed. Env values are passed to processes, never echoed.
- **Probes:** they target only our own app, use only walkthrough accounts and never change another
  user's data. A probe that unexpectedly succeeds is stopped and reported, not explored further.
- **Roles:** no role is granted by script. Admin actions are yours.

## Acceptance criteria

- `docs/PHASE2_REPORT.md` shows each of the five exit criteria as passed with evidence, or clearly
  marked "owed" with the reason and the fallback evidence.
- These hold, with evidence:
  - the agent's listing moves into the verified tier and onto home Featured
  - the lapse removes the badge and the tier only after grace
  - renewal restores them with no new request
  - the rejected owner's period end moves by the credited days
  - the buyer and agent exchange messages in both directions, and an email alert is logged
- Every cross-user probe is refused, and the four access suites pass.
- Dev counts change only by the walkthrough rows. Your accounts are untouched, and the temporary
  branch is gone.
- `typecheck`, `lint`, `npm test` and `npm run test:integration` pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration`. If suites time out on each other, run them one file at a time
  (memory gotcha).
- `npm run build` only if a test file changed under decision 11. No app code changes are expected.

## Manual test steps (after implementation)

1. Read `docs/PHASE2_REPORT.md`.
2. Restart your dev server with `npm run dev` and sign in as your admin:
   - `/admin/verification`: the agent's request is approved, with the view-document and approve
     audit trail, and the owner's request is rejected with its reason.
   - `/admin/jobs`: the notifications run and its sent alert are there.
3. Open http://localhost:3000:
   - the agent's listing is gone from Featured and search, because it was withdrawn at clean-up
   - Explore with `?mode=rent` (or the listing's mode) still shows the sample verified listers
     first
4. During the run I'll ask you for three things:
   - to stop your dev server
   - a phone number for the one sandbox STK prompt, which you approve on the phone
   - three admin decisions in the browser (decision 4)
