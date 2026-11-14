# Cleanup: dead code, duplication, scale

## Goal

Remove dead code, merge copied server code into shared helpers, and make the public site take
more traffic without overloading Neon. No visible change to any page, form or message, except
that public pages may now be up to 5 minutes stale (owner decision 2026-11-14, below).

The codebase is already layered and bounded (every list query has a limit, polling backs off,
no unused locals or parameters). This is a targeted pass, not a rewrite.

## References read

- `AGENTS.md` (layers, business rules, checks)
- `node_modules/next/dist/docs/`: `01-getting-started/08-caching.md`,
  `03-api-reference/01-directives/use-cache.md` (runtime caching considerations),
  `use-cache-remote.md`, `04-functions/updateTag.md`, `revalidateTag.md`, `cacheTag.md`
- Memory: Vercel `fra1` + Neon Frankfurt; parallel sessions share this folder

## Existing code inspected

- Analysis: `tsc --noUnusedLocals --noUnusedParameters` (clean) and a TypeScript language-service
  scan of every export's references across `src/`, `scripts/` and `e2e/`.
- `src/db/index.ts`, `src/db/tx.ts`, `src/lib/rate-limit.ts`, `next.config.ts`, `vercel.json`
- `src/db/queries/public-listings.ts`, `listing-detail.ts`, `ranking.ts`, `messaging.ts`,
  `moderation.ts`, `inquiries.ts`; `src/db/schema.ts` indexes
- `src/app/page.tsx`, `src/app/properties/(search)/page.tsx`, `src/app/properties/[slug]/page.tsx`
- All 16 `"use server"` files, especially `account/profile/avatar-actions.ts` and
  `account/agency/logo-actions.ts`
- `src/app/api/messages/status/route.ts`, `src/components/messaging/message-poller.ts`
- `src/app/api/jobs/[job]/route.ts`, `src/lib/jobs/*`, payment routes under `src/app/api/payments/`

## Findings

1. **Dead code** (no caller outside tests):
   - `homeShowcase` (`public-listings.ts`): superseded by `homeSections`; two integration tests use it
   - `hasInquired` (`inquiries.ts`): superseded by messaging; one integration test uses it
   - `photoKeysForListing` (`listing-photos.ts`), `messagesIn` (`messaging.ts`),
     `openMessageReportCount` (`message-moderation.ts`), `isOpenStatus` (`verification/rules.ts`),
     `CARD_WEBHOOK_PATH` (`card/config.ts`): no references at all
   - Unused type exports: `KenyaCounty`, `PlanCode`, `PaymentStatus` (payments.ts),
     `SignUpIntent`, `SignInInput`, `SignUpInput`, `Db` (db/index.ts), `QueueRow` (moderation.ts only)
   - False positives to **keep**: `maxDuration` in route files (Next config), `invoiceNumberSeq`
     (drizzle-kit reads it), helpers exported only for unit tests, `src/test/*` fakes.
2. **Duplication**:
   - `avatar-actions.ts` and `logo-actions.ts` are the same request → finalize → remove pipeline
     (~110 lines each), differing only in owner key, DB setter, messages and log tag.
   - `"Something went wrong. Please try again."` is redefined in 14 action files; the
     `logFailure(action, error)` helper is copied 9 times (35 inline copies of
     `error instanceof Error ? error.name : "unknown"`).
   - The image upload request schema (`contentType` + `size`) is copied in 3 action files.
   - Four client-action result types are the same `{ ok: true; message } | { ok: false; error }`.
3. **Scale**:
   - No public read is cached: every home and listing-detail view runs several ranking queries
     (each calling `lister_verified_now` per row) against Neon.
   - The search filter `county ILIKE … OR town ILIKE … OR neighbourhood ILIKE …` has a trigram
     index on `town` only, so any text search scans `properties`. The `title` trigram index is
     never used by a WHERE clause (title appears only in `similarity()` in the select list) and
     only slows writes.
   - `checkRateLimits` awaits each Redis check in turn; sign-in does 2 round trips serially.

## Decisions

1. **Caching (owner decision 2026-11-14): include it, 5-minute life.** Use
   `"use cache: remote"` (shared across Vercel instances; plain `"use cache"` lives in per-instance
   memory and rarely survives between serverless requests). Locally it falls back to memory.
   Cache only data that is the same for every visitor:
   - home sections (key: Nairobi date seed, so the daily rotation still changes at midnight)
   - a listing's public detail row by slug, and its similar listings
   Not cached: search results (filter combinations give near-zero hit rate), anything that reads
   the session (save state, contact visibility, map link, "mine"), account and admin pages.
2. Cache profile: `cacheLife({ stale: 60, revalidate: 120, expire: 300 })`, defined once.
   (Corrected during implementation: Next requires `expire` > `revalidate`, and an entry can be
   served stale until `expire`, so `expire` is the real bound: 5 minutes; ~2 under traffic.)
   The verified badge stays derived (business rule): the cache stores the derived result for at
   most 5 minutes; expiry with no write behind it (plan or review lapsing) shows within 5 minutes.
3. Tags, defined once in `src/lib/cache/public-listings.ts`:
   - `public:listings`: every cached public read
   - `public:listing:<id>`: one listing's detail and similar rail (tagged after the row loads)
   - `public:home`: the home sections
4. Invalidation, with `revalidateTag(tag, { expire: 0 })` (works in Server Actions and Route
   Handlers; the next request waits for fresh data). Two helpers only:
   - `invalidateListing(id)`: `public:listing:<id>` + `public:home`. Called by the owner's
     listing actions (edit, submit, pause, unpause, delete, photo add/remove/reorder/cover, map link).
   - `invalidatePublicListings()`: `public:listings`. Called where many listings or a lister's
     badge change at once: moderation approve/reject/take-down, admin verification decisions,
     verification submit/withdraw, avatar and logo changes, lister profile and agency name
     changes, agency join/leave, payment confirmation (STK callback, C2B confirmation, card
     webhook, billing status action, admin billing actions), and the job route after
     `grace-expiry`, `plan-changes`, `verification-lifecycle`, `payment-checks` and `reconciliation`.
   Calls go in `src/app/` (actions and routes) only, never in `src/lib/jobs` or `src/db`, because
   `revalidateTag` throws outside a Next request and `npm run jobs:run` / seeds run in plain Node.
   A taken-down or unpublished listing must disappear immediately, so moderation and owner
   status changes are the must-not-miss calls; the 5-minute life is the backstop for anything missed.
5. Session-dependent parts keep running per request inside their existing `<Suspense>`
   boundaries; the cached functions take only serialisable arguments (strings, plain objects).
6. Upload actions: one server-only helper, `src/lib/storage/avatar-upload.ts`, owns the shared
   request/finalize/remove flow; the two action files become thin wrappers passing an owner
   resolver, a DB setter, messages and a log tag. Listing photos and verification documents keep
   their own actions (different storage rules), but reuse the shared upload request schema.
7. Shared action helpers in `src/lib/action-state.ts` (already the home of action types):
   `GENERIC_FAILURE`, `logActionFailure(tag, action, error)`, and
   `ClientActionResult = { ok: true; message?: string } | { ok: false; error: string }`.
   Files with a deliberately different generic message (billing: "We couldn't start the
   payment…") keep their own.
8. Indexes: add trigram GIN indexes on `county` and `neighbourhood` (with `town`, the OR filter can
   use a bitmap OR); drop `properties_title_trgm_idx`. One migration via `npm run db:generate`.
9. `checkRateLimits` runs its checks with `Promise.all`; same refusal rule (longest retry wins),
   every check still counted.
10. Work on branch `cleanup-dedupe-scale` from `main` (69a9cbe). Check branch and status before
    each commit (another session may share the folder). No push until the owner asks.

11. **Addendum (owner, 2026-11-14): similar listings rail.** On the listing page, the first card of
    "Similar listings" sits flush against the left screen edge on phones. `CardRail`'s list bleeds
    to the edge (`-mx-4`) and re-adds the gutter (`px-4`), but its cards use `snap-start` with no
    scroll padding, so snapping aligns the first card to the scroller edge = the screen edge. Fix:
    `scroll-px-4 sm:scroll-px-0` on the list, matching `PageContainer`'s 16px phone gutter. From
    `sm` the rail has no bleed, so nothing changes there.

## Implementation notes (2026-11-14)

- `invalidateListing(id)` is used only for changes that can hide a listing or change what it
  shows. Anything that can make a listing visible (submit, unpause, approve, payment, unpause by
  plan) clears `public:listings`, because a hidden listing may be cached as "not found" under its
  slug, which carries no id tag.
- Every cached entry is also tagged with the ids of every listing it shows (home cards, similar
  cards), so hiding one listing clears the other pages showing it.
- Payment routes clear the cache inside their `after()` work: Next flushes tags queued there
  (`server/after/after-context.js` wraps callbacks in `withExecuteRevalidates`).
- Verification submit/withdraw were dropped from the call list: neither changes the badge (only a
  decision does). Agency invite, role and data-request actions clear more than needed via the shared
  `refreshAgencyPages()`; they are rare, so kept simple.
- Logging: `errorName` moved from `notifications/deps.ts` to `src/lib/log.ts` with
  `failureLogger(tag)`; 35 inline copies replaced.

## Files likely to change

- New: `src/lib/cache/public-listings.ts`, `src/lib/storage/avatar-upload.ts`, one migration in `drizzle/`
- `src/lib/action-state.ts`, `src/lib/rate-limit.ts` (+ `rate-limit.test.ts`)
- `src/db/schema.ts` (indexes)
- `src/db/queries/public-listings.ts`, `inquiries.ts`, `listing-photos.ts`, `messaging.ts`,
  `message-moderation.ts`, `moderation.ts`, `payments.ts`; `src/db/index.ts`
- `src/lib/verification/rules.ts`, `src/lib/card/config.ts`, `src/lib/kenya.ts`,
  `src/lib/billing/constants.ts`, `src/lib/validation/auth.ts`
- `src/app/page.tsx`, `src/app/properties/[slug]/page.tsx`
- All `"use server"` files listed in finding 2 and decision 4; payment routes; `src/app/api/jobs/[job]/route.ts`
- Tests: `public-listings.integration.test.ts`, `public-exposure.integration.test.ts` (use
  `homeSections().main`), `engagement.integration.test.ts` (drop the `hasInquired` case)

## Implementation requirements

1. Re-run the reference check for each dead symbol (`src`, `scripts`, `e2e`) immediately before
   deleting it. Delete unused functions; for unused types, delete or drop `export` if used locally.
2. Shared helpers are `server-only` where they touch the DB, storage or Next cache.
3. Cached readers live in `src/lib/cache/public-listings.ts`, call the existing query functions
   unchanged, and return the same types. Pages swap their `cache(...)` loaders for these.
   `generateMetadata` and the page keep sharing one read.
4. Home: `connection()` stays before the date seed is computed; the seed is the cache key.
5. Upload helper keeps every current behaviour: session re-check, owner check before signing and
   again on write, rate limit, ingest ownership check, delete the new object if the DB write fails,
   delete the previous object only after the row points at the new one, the same user messages.
6. No change to SQL output columns, public field lists, business rules, rate limits or messages.
7. Do not touch `src/test/*`, migrations already applied, or unrelated UI.

## Security requirements

- Cached data is public-field-only: the detail reader may carry `ownerUserId` (server-side only,
  as today) but must never pass it to a Client Component. Nothing session-, cookie- or
  header-dependent enters a cached scope.
- Moderation take-down, rejection, owner pause and delete invalidate immediately.
- Logs keep the current hygiene (error name only, no keys, ids or personal data).

## Acceptance criteria

- Every symbol in finding 1 (except the listed keepers) is gone; no new unused export.
- `avatar-actions.ts` and `logo-actions.ts` are thin wrappers; no copied `GENERIC_FAILURE` or
  `logFailure` remains except deliberate custom messages.
- Home and listing detail render the same as before; a second request within 5 minutes does not
  query the database for the cached parts (visible in dev logs / Neon query count).
- Editing, pausing or deleting a listing, and an admin take-down, show on the public page on the
  next load. Approving a verification shows the badge on the next load.
- Migration adds the two trigram indexes and drops the title one; `EXPLAIN` of a text search uses
  a bitmap OR over the three indexes.
- All checks below pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (Neon dev test branch)
- `npm run db:generate` (commit the migration), then `npm run db:migrate` on dev
- `npm run build`
- Re-run the dead-code scan and report what is left.

## Manual test steps (after implementation)

1. `npm run db:migrate`, then `npm run dev`.
2. Open `/` twice: the second load is served from cache (no listing queries in the dev terminal).
3. Open a listing; sign in as its owner in another browser, change the price, reload the public
   page: the new price shows at once.
4. Pause the listing: the public page shows "not found" at once; unpause restores it.
5. As admin, take down a reported listing: gone from `/` and its page at once.
6. Upload, replace and remove a profile photo (`/account/profile`) and an agency logo
   (`/account/agency`): same messages and behaviour as before; the card avatar updates.
7. Search `/properties?q=westlands`, `q=nairobi`, `q=kilimani`: same results as before.
8. Sign in 6 times with a wrong password: the 6th is refused with the same message.
