# S19 Security and authorization audit (Phase 4, part 1)

## Goal

Tick the plan §12 "Security and authorization tests" list with evidence. Every rule gets a
named, passing test:

- an existing test where one already proves it
- a new test where none does

Any hole the new tests find is fixed in this slice. The result is `docs/SECURITY_TESTS.md`, a
matrix from each plan rule to the test or tests that prove it. Phase 4 exit (§12, launch
checklist "Authentication: authorization tests passing") reads from it.

Phase 3 (location) was skipped by your decision on 2026-11-10. So "never expose exact
coordinates" is covered by the private-column guard below, not by map work.

No new features or UI. Schema changes only if a test finds a real hole, and then only with a
migration.

## Phase 4 slice plan (for orientation; each gets its own prompt)

| Slice | Scope | Needs from you |
|---|---|---|
| **S19 security audit** (this) | §12 security tests, the matrix, gap fixes | nothing |
| S20 legal and content | Privacy notice, terms, subscription and refund policy, moderation and report process, data-request route, footer links, dead-link check | review the wording; it is technical guidance, not legal advice |
| S21 monitoring and operations | Error monitoring and alerts, an alert when payment callbacks stop, structured-log review, backup restore rehearsal on a Neon branch, incident-response note | an alert email or phone; any monitoring account choice |
| S22 end-to-end, accessibility, performance | Playwright flows from §12 (Edge, minus the dropped List/Map flow), accessibility audit, performance pass | nothing |
| S23 payments go-live | Daraja production credentials, KES 1 live payment and refund, first reconciliation against the statement, refund and dispute process | Paybill or Till, production Daraja app, eTIMS/VAT answer from your accountant |
| S24 launch exit | Run the §15 launch checklist end to end, then the report | sign-off |

## References read

- `AGENTS.md`:
  - §5: layers; every query scoped by session
  - §6: business rules
  - §8: security
  - §9: checks; integration tests on the Neon test branch
- `docs/implementation-plan-v2.md`:
  - §12 security list, with "optional row-level policies"
  - §14 cross-cutting authorization rule
  - §15 launch checklist (Authentication, Messaging, Operations)
- `docs/PHASE1_REPORT.md` and `docs/PHASE2_REPORT.md`: cross-user checks already shown in the
  exit runs
- Memory:
  - `local-env-browser-db`: integration-test isolation, unique fixture ids per suite, soft 404s
  - `vercel-deploy-state`: production is not touched by tests

## Existing code inspected

Coverage found. Each test is cited by file and test name.

| Plan §12 rule | Existing evidence |
|---|---|
| Anonymous user can't read draft, rejected or paused listings | `public-listings.integration.test.ts` loops every non-published status (line ~194); `seed.integration.test.ts` "never shows the draft, pending and rejected listings" |
| Agent A can't read or modify Agent B's drafts | `listings.integration.test.ts` "lets the owner and their agency admin manage a listing, nobody else"; `listing-photos` "…not a plain member or a stranger" |
| …or Agent B's invoices or payments | `invoice-actions.integration.test.ts` "lets only the plan's manager act, and hides other owners' invoices"; `billing-ui` "keeps payments and receipts within the pool" |
| Agent can't approve their own verification | `verification.integration.test.ts` "blocks self-review and cross-user access to uploads and documents" |
| Buyer A can't read Buyer B's messages | `messaging.integration.test.ts` "blocks every kind of cross-user access to a conversation" |
| Buyer A can't read Buyer B's favourites | **no test.** `engagement` only covers unavailable listings |
| User can't grant themselves a role | `auth.integration.test.ts` "grants only buyer_tenant at sign-up, even when the body forges a role", "…ignoring forged fields", "grants operator roles only to verified accounts" |
| …mark themselves verified | `schema.integration.test.ts` "cannot mark a review verified without a decision and expiry"; billing "badge … is true with a passed review and both subscriptions paid" |
| …extend their own subscription | Only confirmed payments extend a subscription (`payments` replay and mismatch tests). **Not proven:** no test shows admin billing actions refuse a non-admin |
| …change their ranking | Ranking is derived (`ranking.ts`); no input path exists. **Not proven** by a test |
| Publishing past the plan limit, or with a lapsed plan, is refused | `listings` "enforces the plan limit…", "blocks submit without a plan…", "un-pauses with a paid-up plan and refuses during grace"; `moderation` "refuses approval when the lister's plan is not active" |
| Forged callback from outside Safaricom's IPs is rejected | `callback-guard.test.ts` (unit; uses `x-real-ip`, which Vercel overwrites); `card.test.ts` for the Paystack webhook |
| Replayed callback doesn't double-credit | `payments` "does not extend the plan twice when the same callback is replayed", "…ignores a replayed TransID" |
| Amount mismatch is flagged, not activated | `payments` "flags an amount mismatch and activates nothing"; `admin-actions` "refuses a wrong amount…" |
| Public APIs never expose exact coordinates, documents, payment details or private columns | Partial: `verification` "audits every admin document view and hides documents from everyone else". **No single guard over all public reads** |
| Rate limits stop login, inquiry, messaging and STK abuse | `rate-limit.test.ts` (policy behaviour); `payments` "rate-limits payment starts per user"; `engagement` "…a 4th in a day"; `messaging` "refuses a double send". **Not proven** that the sign-in, sign-up and reset actions apply their policies |
| Optional: Postgres row-level policies | Not built |

Also inspected:

- `src/app`: 52 pages and routes. 16 call `requireRole`, and 39 use a `require*` session guard.
  Nothing stops a new admin page from shipping without its guard.
- `src/app/api/dev-storage/*`: local-only storage routes. Their production refusal is in code, but
  no check runs against a production build.
- `src/lib/request.ts`, `callback-guard.ts`: IP handling is deliberate (comment at line 72).

## Decisions and assumptions

1. **Matrix first, then gaps.** `docs/SECURITY_TESTS.md` lists every §12 rule. Each row has:
   - its tests (file and test name)
   - a status: covered, added in S19, or not applicable
   - one line on *why* the test proves the rule

   Existing tests are cited, not rewritten.
2. **New tests, only for the gaps marked above:**
   1. **Public data guard** (integration, `src/db/queries/public-exposure.integration.test.ts`):
      - **Fixture:** a published listing owned by an *unverified* lister, with every private
        column filled with a unique marker. That covers:
        - exact and public coordinates
        - owner email and phone
        - an agency admin's email
        - a verification document storage key
        - an invoice, payment receipt and checkout id
        - the address label
        - a rejected listing's reason on a sibling listing
      - **What it calls:** every exported public read in:
        - `public-listings.ts` (search, home sections, strip)
        - `listing-detail.ts`
        - `ranking.ts`
        - the engagement reads a visitor sees (similar listings)
        - public lister data
      - **The check:**
        - no marker value appears anywhere in the JSON of the results
        - no key matches the private-name list (`email`, `phone` unless it's the
          verified-lister public phone field, `latitude`, `longitude`, `receipt`, `checkout`,
          `invoice`, `storageKey` for private documents, `passwordHash`, `reviewedBy`)
      - **Documented exceptions:**
        - The test lists each documented exception. One example is `ownerUserId` in
          `listing-detail`, used server-side for the owner check.
        - It asserts each exception is used server-side and not passed to client components.
          This is a static check that the page passes only named props.
   2. **Favourites isolation** (integration, added to `engagement.integration.test.ts`):
      - Buyer A saves listings.
      - Buyer B's saved list and `savedIdsAmong` show none of them.
      - B can't remove A's favourite.
   3. **Non-admin refusals** (integration, added to `admin-actions.integration.test.ts`):
      - A lister, and a buyer, calling each admin billing action is refused with `not_allowed`,
        and nothing changes. That covers activate payment, record Paybill and extend or credit.
      - The same for moderation approve and reject in `moderation.integration.test.ts`.
      - It runs at the server-action level (the role check), not only the query layer.
   4. **Route guard sweep** (unit, `src/app/route-guards.test.ts`). A static scan:
      - every `page.tsx`, `route.ts` and `actions.ts` under `src/app/admin/**` calls
        `requireRole`
      - every one under `src/app/account/**` calls `requireUser`, `requireLister` or
        `requireRole`
      - every exported Server Action in `src/app/**/actions.ts` starts with a session guard or
        is on a named public allowlist (sign-in, sign-up, reset, inquiry entry)

      A new unguarded file fails the test with its path.
   5. **Rate-limit wiring** (unit, same scan file):
      - the sign-in, sign-up, reset, resend-verification, inquiry, message, STK start and photo
        upload actions each reference their `POLICIES.*` entry
      - `rate-limit.test.ts` already proves the policies themselves block
   6. **Ranking can't be bought or set by a user** (integration, in
      `public-listings.integration.test.ts`):
      - Two otherwise identical published listings are ranked.
      - Changing any lister-editable field the lister can change (title, price, description,
        photos count) never moves an unverified listing above a verified one.
      - Only the derived verified tier does.
   7. **Production build sweep** (script, `scripts/security-sweep.ts`, `npm run security:sweep --
      --base http://localhost:3005`), run against `next build && next start -p 3005`. Signed out:
      - every static `/account/**` and `/admin/**` route redirects to sign-in
      - `/api/dev-storage/*` returns 404
      - the STK callback path with a wrong token returns 404 and records nothing
      - a non-published SAMPLE slug shows the not-found UI (soft 404, as accepted in S11)
      - `/api/jobs/*` without a QStash signature is refused

      It prints a pass/fail table and is not part of `npm test`.
3. **Row-level security: not adopted.** The plan marks it optional. Every query is already scoped
   in the data layer, and the guard tests above lock that in. Adding policies now would touch
   every query path for defence in depth we don't need before launch. The matrix records this as
   "not adopted, reason".
4. **Fixtures.** New integration fixtures use unique ids with an `s19_` prefix. They roll back or
   clean up as the existing suites do, so the parallel run stays safe (memory gotcha).
5. **When a test finds a hole:**
   - Fix it in the smallest place: the query scope or the action guard.
   - Add the fix to the matrix with the test that now proves it.
   - If the fix changes behaviour a user would notice, I stop and tell you before continuing.

## Amendments during implementation (2026-11-10)

- **A1. Non-admin refusals are proven where the role check lives.** The role check is in the
  Server Actions (`requireRole`), not in the `src/lib` functions the integration suites call. So
  decision 2.3 is proven by:
  - `src/lib/session.test.ts`: `requireRole` gives every non-admin role a 404, and keeps
    billing admins out of moderation
  - the static scan: every admin action and page calls `requireRole` with an admin-only set
  - the sweep's forged-session pass

  No new integration test was added in `admin-actions` or `moderation`.
- **A2. The contact rule had no unit test**, so `src/lib/listings/contact.test.ts` was added
  (rule 7).
- **A3. The sweep gained a forged-cookie pass.** `src/proxy.ts` only checks that a cookie exists.
  A plain signed-out sweep only exercises the proxy, so every account and admin page is also hit
  with a made-up session cookie, which reaches the page's own guard.
- **A4. The sweep needs placeholder Upstash settings.** A local production build answers 500 to
  every payment callback without them, and the live site has them. The start command is
  `UPSTASH_REDIS_REST_URL=http://127.0.0.1:9 UPSTASH_REDIS_REST_TOKEN=sweep npx next start -p 3005`
  (observation O1 in `docs/SECURITY_TESTS.md`).
- **A5. Finding F1 was first reported, not fixed.** All 12 admin pages showed their title and
  description to a forged session, and fixing it changes what admins see while a page loads. Per
  decision 5 it waited for your decision.
- **A6. F1 fixed (you approved it, 2026-11-10):**
  - `AdminGate` (a role check, then children) wraps each admin page body.
  - Page titles were replaced by one neutral `"Admin"` layout title, because the prerendered
    `<title>` leaked as well.
  - The scan and the sweep now enforce both.

## Files likely to change

- `docs/SECURITY_TESTS.md` (new)
- `src/db/queries/public-exposure.integration.test.ts` (new)
- `src/db/queries/engagement.integration.test.ts`
- `src/lib/billing/admin-actions.integration.test.ts`
- `src/db/queries/moderation.integration.test.ts`
- `src/db/queries/public-listings.integration.test.ts`
- `src/app/route-guards.test.ts` (new)
- `scripts/security-sweep.ts` (new), and `package.json` (`security:sweep`)
- Only if a hole is found: the affected query or action file, with a test

## Implementation requirements

1. Build the matrix by reading each cited test, to confirm it really proves the rule. Correct the
   table above where it overstates.
2. Write the new tests in decision 2's order. Each new test file has a header comment naming the
   §12 rule it proves.
3. **The public data guard:**
   - Marker values are random, like `S19MARK-<uuid>`.
   - Search is a deep walk of the JSON-serialised results, so nested lister or photo objects are
     covered.
   - The exception list is a named constant with one comment per entry.
4. **The route-guard scan:**
   - It uses the file system and simple source matching: import of `requireRole` and friends,
     plus a call. It's not a TypeScript AST.
   - It runs in under 1 s.
   - Failures print the file and the missing guard.
5. **The sweep script:**
   - Uses `fetch` with `redirect: "manual"` and a 10 s timeout.
   - Has no credentials, so it never needs secrets.
   - Uses a default base of `http://localhost:3005`.
   - Refuses any base whose host is not `localhost` or `127.0.0.1`, unless `--allow-remote` is
     passed. That keeps it from being aimed at the live site by accident.
6. **No change to production data.** Integration tests use the Neon test branch only.

## Security requirements

- The tests and the sweep never print secrets. Marker values are synthetic.
- No test or script touches the production branch or the live site, except the sweep with an
  explicit `--allow-remote`. I won't run it remotely without asking.
- Any fix keeps the existing rules:
  - session-scoped queries
  - typed errors with no internals
  - server-decided entitlements
  - append-only payment and audit records

## Acceptance criteria

- `docs/SECURITY_TESTS.md` maps every §12 rule to passing tests, or to "not adopted" with a reason
  (row-level policies only).
- All seven new tests exist and pass. Any hole they found is fixed and listed.
- `npm run security:sweep` against a local production build prints all rows passing.
- The full integration suite passes on the test branch.
- `typecheck`, `lint`, `test` and `build` pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test` (includes `route-guards.test.ts`)
- `npm run test:integration` (full suite; no-parallel fallback if the Frankfurt link drops)
- `npm run build`, then `npx next start -p 3005` and `npm run security:sweep`

## Manual test steps (after implementation)

1. Read `docs/SECURITY_TESTS.md`. Every §12 line has a test name and status.
2. Run `npm test`. It includes the route-guard scan. To see the scan catch a gap:
   1. Temporarily add an empty `src/app/admin/zz-test/page.tsx` that exports a component with no
      guard.
   2. `npm test` fails, naming that file.
   3. Delete it.
3. Run `npm run test:integration`. All suites pass, including `public-exposure`.
4. Build and run the sweep:
   1. `npm run build`
   2. `npx next start -p 3005`
   3. in a second terminal, `npm run security:sweep`

   Every row passes. Stop the server afterwards.
5. Optional: open `/account/listings` in a private window. You land on sign-in.
