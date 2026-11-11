# Security and authorization tests

Prompt: `prompts/s19-security-audit.md` (Phase 4, part 1). Run on 2026-11-10 on branch
`s19-security-audit`.

This maps every rule in plan §12, "Security and authorization tests", to the tests that prove it.
Phase 4 exit (§12, and the launch-checklist line "Authorization tests passing") reads from here.

## Result

| Check | Result |
|---|---|
| `npm test` | 53 files, 504 tests passed (219 integration tests skipped without `TEST_DATABASE_URL`) |
| `npm run test:integration` (Neon test branch `ep-frosty-sun-b96cfi03`) | 20 files, 219 tests passed |
| `npm run security:sweep` (local production build) | 74 of 74 passed, with no warnings, after the F1 fix |
| `npm run typecheck`, `npm run lint`, `npm run build` | passed |

Every rule is proven, and the one finding the audit turned up, F1, is fixed. Admin page titles
were visible to a forged session cookie.

## Matrix

"S19" marks a test added in this slice. Integration tests run against the Neon test branch, in
transactions that are rolled back.

| # | Plan §12 rule | Proven by | Why it proves it |
|---|---|---|---|
| 1 | An anonymous user can't read a draft, rejected or paused listing | `public-listings.integration` "returns only published listings, on search and the home page"; `seed.integration` "never shows the draft, pending and rejected listings"; **S19** `public-exposure.integration` "returns nothing at all for listings that are not published"; **S19** sweep "unknown listing shows not found" | Tries every non-published status against search, home and the detail lookup |
| 2a | Agent A can't read or modify Agent B's drafts | `listings.integration` "lets the owner and their agency admin manage a listing, nobody else"; `listing-photos.integration` "…not a plain member or a stranger" | Strangers get `not_found` on read, edit, submit and photo actions |
| 2b | …or Agent B's invoices or payments | `invoice-actions.integration` "lets only the plan's manager act, and hides other owners' invoices"; `billing-ui.integration` "keeps payments and receipts within the pool" | A stranger gets `not_found`, a plain member `forbidden`, and the invoice stays open |
| 2c | An agent can't approve their own verification | `verification.integration` "blocks self-review and cross-user access to uploads and documents" | `approveRequest` by the lister returns `self_review`. Another user's upload key is refused |
| 3a | Buyer A can't read Buyer B's messages | `messaging.integration` "blocks every kind of cross-user access to a conversation" | An outsider can't read, list, mark read, poll or send |
| 3b | …or Buyer B's favourites | **S19** `engagement.integration` "keeps each buyer's saved listings to themselves" | Another user sees none of the buyer's saves. Their "unsave" leaves the buyer's alone, and saving creates only their own row |
| 4a | A user can't grant themselves a role | `auth.integration` "grants only buyer_tenant at sign-up, even when the body forges a role", "saves a lister profile and its role together, ignoring forged fields", "grants operator roles only to verified accounts"; **S19** `session.test` "ignores a role claimed on the session object: only database roles count" | Forged role fields are dropped. Only database roles count |
| 4b | …or use an admin action | **S19** `session.test` "refuses a buyer / owner / agent / agency admin every admin area with a 404", "keeps billing admins out of moderation and verification"; **S19** `route-guards.test` "every admin page and route checks an admin role", "admin guards pass only admin role sets", "guards every exported action…"; **S19** sweep (forged session on every admin page) | Every admin action calls `requireRole` with an admin-only set (static scan), and `requireRole` refuses non-admins (unit test) |
| 4c | …or mark themselves verified | `schema.integration` "cannot mark a review verified without a decision and expiry"; `billing.integration` badge tests ("is true with a passed review and both subscriptions paid", "…false once either subscription is past grace or stopped"); `verification.integration` self-review test (2c) | The badge is derived in SQL. Only an admin decision, never your own, sets `verified` |
| 4d | …or extend their own subscription | `payments.integration` "does not extend the plan twice when the same callback is replayed", "flags an amount mismatch and activates nothing"; `admin-actions.integration` refusal tests; 4b for the admin billing actions | Only a confirmed payment or an admin action (role-checked) extends a period |
| 4e | …or change their ranking | **S19** `public-listings.integration` "never lets edits or a payment alone lift an unverified listing above a verified one"; existing "puts verified listers first…" | An unverified listing with every lister-editable field at its best, and a lister who paid but isn't reviewed, both stay below an old, photo-less verified listing |
| 5 | Publishing past the plan's limit, or with a lapsed plan, is refused | `listings.integration` "enforces the plan limit, counting listings in review", "blocks submit without a plan…", "un-pauses with a paid-up plan and refuses during grace", "shares the agency's plan across members"; `moderation.integration` "refuses approval when the lister's plan is not active" | Refused at submit, un-pause and approval |
| 6a | A forged callback from outside Safaricom's IPs is rejected | `callback-guard.test` (exact token; inside or outside the ranges; malformed; IPv4-mapped; `x-real-ip` first); `card.test` for the Paystack webhook; **S19** sweep (wrong-token STK and C2B → 404; unsigned card webhook refused) | The token comes first (404), then the IP allowlist (403, recorded) |
| 6b | A replayed callback doesn't double-credit | `payments.integration` "does not extend the plan twice…", "…ignores a replayed TransID", "treats a Paybill confirmation of the STK receipt as a duplicate" | The period end is unchanged after a replay |
| 6c | An amount that doesn't match the invoice is flagged, not activated | `payments.integration` "flags an amount mismatch and activates nothing", "…flags Paybill amount mismatches"; `admin-actions.integration` "refuses a wrong amount and changes nothing" | The payment is `flagged`, the subscription stays `pending` and the invoice stays `open` |
| 7 | Public APIs never expose exact coordinates, verification documents, payment details or private columns | **S19** `public-exposure.integration` (6 tests); `public-listings.integration` "returns public card fields only"; `verification.integration` "audits every admin document view and hides documents from everyone else"; **S19** `contact.test` (contact rule); **S19** `route-guards.test` "never passes the listing owner id into the public listing page's JSX" | More than 20 unique markers sit in every private column. Neither a marker nor a private-sounding key comes back from search (every sort), the home sections, detail, similar or saved |
| 8 | Rate limits stop obvious login, inquiry, messaging and STK Push abuse | `rate-limit.test` (policies block); `payments.integration` "rate-limits payment starts per user", "refuses a second push within 90 seconds…"; `engagement.integration` "…a 4th in a day"; `messaging.integration` "refuses a double send within a minute…"; **S19** `route-guards.test` "public actions … apply their rate limits", "abuse-prone signed-in actions apply their rate limits" | The policies block, and the static scan proves each sign-in, sign-up, reset, resend, inquiry, report, save, message, photo, password and STK path applies its policy |
| 9 | Optional: Postgres row-level policies, driven by a per-request session setting | **Not adopted** | See below |

### Row-level policies: not adopted

The plan marks these optional. Every query is already scoped by the session in the data layer,
and these tests lock that in:
- rules 2–3, cross-user access
- rule 7, the exposure guard
- the static scan, which stops a new page or action from shipping without its guard

Adding policies would touch every query path, and the transaction setup, for defence in depth
that isn't needed before launch. Revisit after launch if the data layer grows beyond these
patterns.

## Tests added in S19

| File | What it proves |
|---|---|
| `src/app/route-guards.test.ts` (unit, 13 tests) | <ul><li>Every admin and account page, route and Server Action calls its guard, or is a named public action with its reason</li><li>Admin guards use admin-only role sets</li><li>The abuse-prone actions apply their rate limits</li><li>The auth handler exports GET only</li><li>The listing owner id never reaches JSX</li><li>Every admin page renders inside `AdminGate`, with no title of its own (F1)</li></ul> |
| `src/lib/session.test.ts` (unit, 11 tests) | <ul><li>`requireUser` sends signed-out and unverified users to sign-in</li><li>`requireRole` gives every non-admin role a 404 and keeps billing admins out of moderation</li><li>Only database roles count</li></ul> |
| `src/components/admin/AdminGate.test.ts` (unit, 2 tests) | <ul><li>Children render only after the role check passes</li></ul> |
| `src/lib/listings/contact.test.ts` (unit, 3 tests) | <ul><li>Unverified listers' details stay hidden until an inquiry</li><li>A verified lister's phone is public, their email is not</li></ul> |
| `src/db/queries/public-exposure.integration.test.ts` (6 tests) | The marker guard over every public read (rule 7) |
| `engagement.integration.test.ts` (+1 test) | Favourites isolation (rule 3b) |
| `public-listings.integration.test.ts` (+1 test) | Ranking can't be bought or edited (rule 4e) |
| `scripts/security-sweep.ts` (`npm run security:sweep`) | 74 checks against a production build. Each account and admin page is hit both signed out (the proxy redirects) and with a forged session cookie (the page's own guard redirects). It also checks dev storage is off, payment callbacks refuse a wrong token, webhooks and job calls refuse unsigned requests, the message poll refuses without a session, the auth API refuses writes, and an unknown listing shows not found |

**The new tests were checked by breaking things on purpose:**
- **Route-guard scan:** adding an unguarded admin page, and an unguarded exported action, failed
  `route-guards.test.ts` with both paths named.
- **Exposure guard:** adding `addressLabel` and the exact latitude to the detail query failed
  `public-exposure.integration` ("detail s19x-listing leaks address-label").

Both changes were reverted.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| F1 | **Admin page titles show to a forged session.** `src/proxy.ts` only checks that a session cookie *exists*. With any made-up cookie, all 12 admin pages return their prerendered shell: the `<h1>` and description (for example "Billing", "Listings awaiting moderation"). The page's own guard then streams a redirect to sign-in. No admin data, navigation or tables are sent; those stay inside the role-guarded boundary. But `requireRole` is meant to stop admin URLs revealing that they exist ("404 … so admin URLs do not reveal that they exist"), and the shell partly defeats that. | Low | **Fixed (you approved it, 2026-11-10).** <ul><li>A new `src/components/admin/AdminGate.tsx` runs `requireRole` before rendering anything. All 12 admin pages wrap their whole body in `<Suspense><AdminGate>`, and their data components keep their own `requireRole`.</li><li>Page titles moved to one neutral `"Admin"` title on the admin layout. The prerendered `<title>` was leaking too.</li><li>Admins now see a skeleton until the role check passes, then the heading and content. Their browser tabs read "Admin".</li><li>The scan (`route-guards.test.ts`) and the sweep (no `<h1>`, no admin titles) now fail if it comes back.</li></ul> |
| O1 | **Local production builds need Upstash settings.** Without them, a local `next start` answers 500 to every payment callback: a production build refuses to run without a rate limiter, and the callbacks build it before checking the token. The live site has Upstash configured, so it is not affected. An Upstash *outage* doesn't trigger this either, because the client is only created and makes no network call. The sweep starts the build with placeholder Upstash values. | Info | Documented. Relevant to S21: an alert when callbacks stop arriving |
| O2 | **The proxy is only a quick first check.** `src/proxy.ts` is cookie-presence only, as its comment says. Real enforcement is the page and action guards; the sweep's forged-session pass and the static scan prove both. | Info | As designed |

## Later additions

- **S20 (data requests):**
  - `createDataRequestAction` (`requireUser`, `POLICIES.dataRequestPerUser`) and `closeDataRequestAction` (`requireRole(["platform_admin"])`) are covered by `route-guards.test.ts`.
  - `/admin/data-requests` is the 13th admin page under `AdminGate`.
  - The sweep has 77 checks. The new one: signed out, or with a forged session, `/privacy/request` never shows the form.
- **S21 (monitoring):**
  - `route-guards.test.ts`: the ops health route compares `OPS_HEALTH_TOKEN` in constant time and 404s otherwise; the public health route returns only `{ status }`.
  - `src/lib/log-hygiene.test.ts`: no `console.*` call under `src/` logs an error's `.message`, a raw error or provider string, or an unmasked email or phone.
  - The sweep has 79 checks. The new ones: `/api/health` returns exactly `{"status":"ok"}`; `/api/health/ops/<wrong token>` returns 404 with no body.

## How to run

```
npm test
npm run test:integration
npm run build
# Placeholder Upstash values make the local build behave like the live site (O1).
UPSTASH_REDIS_REST_URL=http://127.0.0.1:9 UPSTASH_REDIS_REST_TOKEN=sweep npx next start -p 3005
npm run security:sweep     # in a second terminal
```

The sweep refuses any non-local base unless `--allow-remote` is passed. It sends no real
credentials.
