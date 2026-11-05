# S11 follow-up: fix the exit-run findings

## Goal

Fix the four problems the Phase 1 exit run found (`docs/PHASE1_REPORT.md`, findings F1–F4).

## References read

- `AGENTS.md` (§1 design rules, §8 security, §9 checks)
- `docs/PHASE1_REPORT.md`, the findings section
- Next 16 docs in `node_modules/next/dist/docs/`:
  - `02-guides/streaming.md`, "The HTTP contract". Once a `<Suspense>` boundary streams, the
    status is committed as 200. To get a real 404, `notFound()` must run before any `await` that
    suspends under `<Suspense>`.
  - `03-file-conventions/not-found.md`
  - `02-route-segment-config/instant.md`. `export const instant = false` opts a segment out of
    the static-shell check, so it may block before streaming.
- Memory: Vercel deploy state. The live site is `https://verifiedpropertieske.vercel.app`, the
  buckets were created with a hyphenated origin, and pushes to `main` deploy.

## Existing code and state inspected

- `src/app/properties/[slug]/page.tsx`:
  - The default export wraps `ListingDetail` in `<Suspense>`.
  - `ListingDetail` awaits `params` and `loadListing` and calls `notFound()` inside the stream,
    so the status is 200.
  - `generateMetadata` already returns `robots: { index: false }` for a missing listing.
  - `loadListing` is a React `cache()` around `getPublicListing`.
- `src/components/layout/SiteFooter.tsx`: static links, including "Log in" and "Get started",
  rendered in the root layout for everyone.
- `src/components/layout/SiteHeader.tsx`: `HeaderAccount` reads the session behind
  `<Suspense fallback={null}>` and shows `AccountMenu` or the Log in / Get started links.
- **Bucket CORS** (read with `GetBucketCors` on 5 Nov). Both `listing-photos` and
  `private-uploads` have:
  - origins `https://verified-properties-ke.vercel.app`, `http://localhost:3000`,
    `http://127.0.0.1:3000`
  - methods `PUT`, `GET`, `HEAD`; header `content-type`; max age 3600
  A preflight from the live origin gets 403.
- **Callback IP allowlist:** `src/lib/mpesa/config.ts` `allowedIpsFor`. Production defaults to
  the Safaricom /24s. In sandbox the allowlist is enforced only when
  `MPESA_CALLBACK_ALLOWED_IPS` is set, and it isn't set in Vercel. The real sandbox callback in
  the exit run came from `196.201.212.69`, inside `196.201.212.0/24`.

## Decisions and assumptions

1. **F1, real 404 on the listing detail page.**
   - The page becomes `async`. It awaits `params`, runs `loadListing(slug)` and calls
     `notFound()` before rendering any `<Suspense>`. The existing `cache()` means the page, the
     metadata and `ListingDetail` still share one query.
   - Add `export const instant = false` to this page only, so it may block on that one query
     before streaming.
   - **Trade-off:** the detail page no longer serves an instant static shell. The first byte
     waits for one indexed query (about 0.2 s from fra1).
   - The session-dependent parts (contact panel, save state, similar listings) stay behind their
     `<Suspense>` boundaries, so only the existence check blocks.
   - Every other route is unchanged.
2. **F2, bucket CORS.** Replace the hyphenated origin with `https://verifiedpropertieske.vercel.app`
   on both buckets, using `PutBucketCors` from a one-off script in the gitignored
   `.data/exit-run/`.
   - Keep `http://localhost:3000` and `http://127.0.0.1:3000`.
   - Same methods, header and max age as before. No `*` origin.
   - This is account configuration, not app code. Nothing is committed for it except the report.
3. **F3, allowlist in the live sandbox.** Add `MPESA_CALLBACK_ALLOWED_IPS` to Vercel
   **production** through the Vercel connector, with the value
   `196.201.212.0/24,196.201.213.0/24,196.201.214.0/24` (not secret). It takes effect with the
   next Git deploy, which the fix commit triggers. Local `.env` stays unset, so the simulator
   keeps working.
4. **F4, footer account links.** "Log in" and "Get started" move into a small `FooterAccount`
   server component.
   - It reads the session through `getCurrentUser()` behind `<Suspense fallback={null}>`, the
     same pattern as the header.
   - Signed out, it renders the two links. Signed in, it renders "My account" (`/account`).
   - The other footer links stay static.
5. **Out of scope:**
   - other soft-404 routes (account and admin pages are behind sign-in and not indexed)
   - moving the live site off the dev branch
   - Resend, Paystack and Daraja go-live

## Files likely to change

- `src/app/properties/[slug]/page.tsx` (F1)
- `src/components/layout/SiteFooter.tsx`, plus a `FooterAccount` component in the same file (F4)
- `docs/PHASE1_REPORT.md`: findings marked fixed, with evidence
- Account configuration, not committed: bucket CORS (F2) and the Vercel production env var (F3)

## Implementation requirements

- **F1:**
  - `notFound()` runs before any `<Suspense>`.
  - Keep `generateMetadata` as is.
  - `ListingDetail` receives the loaded result instead of re-reading `params`, so there's no
    second lookup.
  - No other behaviour changes: drafts, pending, paused, rejected and missing slugs all 404, and
    published listings render exactly as before.
- **F4:**
  - No session read outside `<Suspense>`.
  - Same link styling; a 44px hit area per the touch-target rule.
  - Only the existing type tokens (`text-small`).
- **F2:** read the rules back with `GetBucketCors` after writing, and repeat the preflight from
  both origins.
- **F3:** create the variable as a plain (non-sensitive) production variable.

## Security requirements

- No `*` origin and no new allowed headers or methods on the buckets.
- Storage credentials are read only from the env files by the script and never printed.
- The allowlist value contains only Safaricom's published ranges. Production behaviour doesn't
  change, because its default is the same ranges.
- The 404 path still leaks nothing about hidden listings: same not-found page, `noindex`.

## Acceptance criteria

- **F1:** locally, a missing slug, the sample draft, pending and rejected listings, and the
  withdrawn walkthrough listing return **HTTP 404** with the "Listing not found" page. A
  published sample listing returns 200 with its content. The same on the live site after deploy.
- **F2:** a preflight from `https://verifiedpropertieske.vercel.app` returns 200 with the
  allow-origin header on both buckets. Localhost still passes. You confirm one real photo upload
  on the live site.
- **F3:** the Vercel production env lists `MPESA_CALLBACK_ALLOWED_IPS`. After deploy, a forged
  callback to the live callback URL from this machine returns **403** and records a
  `callback_rejected` event.
- **F4:** signed out, the footer shows Log in and Get started. Signed in, it shows My account
  instead. There are no console errors and no layout shift beyond the link swap.
- **Checks:** typecheck, lint, unit tests and build pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (route config changed)
- Browser check at 1280px and 390px: the detail page and the footer, signed in and signed out

## Manual test steps (after implementation)

1. **Status codes:** `curl -s -o /dev/null -w "%{http_code}" https://verifiedpropertieske.vercel.app/properties/sample-draft-listing`
   prints `404`. With `sample-karen-4br-house` it prints `200`.
2. **Footer:** open the live site signed out and check the footer shows Log in and Get started.
   Sign in and check it shows My account.
3. **Live photo upload:** signed in on the live site, add a photo to a draft listing. It uploads
   and shows.
4. **Callbacks:** a real sandbox payment still confirms, because Safaricom's IP is allowed. A
   forged callback from your machine gets 403.
