# Quality report: end-to-end, accessibility, performance

Prompt: `prompts/s22-e2e-a11y-perf.md` (Phase 4, part 4). Run on 2026-11-11 on branch
`s22-e2e-a11y-perf`.

This covers the last "Quality and operations" items of plan §12 and the launch-checklist line
"Mobile, accessibility and security checks complete" (§15). Security is in `docs/SECURITY_TESTS.md`
(S19). Monitoring and the restore rehearsal are in `docs/OPERATIONS.md` (S21).

## Result

| Check | Result |
|---|---|
| `npm run e2e`, final suite, run 7 (fresh reset) | 26 passed, 7 skipped by design (desktop-only checks in the mobile project and the reverse), no retries, 24.2 min |
| `npm run e2e`, final suite, run 8 (fresh reset) | Environment failure, not counted. The e2e branch in Frankfurt stopped answering 14 minutes in ("Error connecting to database: fetch failed" on every query). Every later test and its retry failed on that. No failure pointed at the app |
| `npm run e2e`, final suite, run 9 (fresh reset, 2026-11-12) | 27 passed (26 tests plus the route warm-up), 7 skipped by design, no retries, 28.7 min. No database errors, and each route compiled once |
| Earlier runs while the suite settled | Runs 1, 2 and 3 passed apart from suite issues since fixed. Runs 4 and 6 hung in setup on a dev-server reload loop. Run 5 was flaky on a slow link. See "Suite stability" |
| Forms before hydration | With the app's JavaScript blocked, sign-up posts natively: a valid submit reaches "Check your email", and a bad one shows both errors and keeps the typed values |
| Plan §12 flows | 8 of 8 have a passing test (Mobile List-to-Map was dropped with Phase 3) |
| axe-core, WCAG 2.1 A + AA | 0 violations on 33 pages, desktop and mobile, after fix A1 |
| No horizontal scroll at 390px, 320px and 200% zoom | Passed on every page checked |
| Target size | Passed after fix A2, with one documented 32px control (A4) |
| Keyboard | Skip link works, every tab stop shows focus, the menus and the filter sheet open and close by keyboard and return focus, and focus stays on Sort after a sort change (A5) |
| CLS (layout shift) | 0 to 0.05 on every page measured (target < 0.1) |
| LCP, desktop | 0.8 to 1.8 s on the live site (target < 2.5 s) |
| LCP, mobile | **Missed** on search (5 to 6.5 s simulated) and at times the listing page (1.5 to 3.5 s); see P4 |
| Query plans | Every table in the search and home queries has an index path. Fix P1 stops the verified check being repeated per row |
| `npm run typecheck`, `npm run lint`, `npm run build` | Passed |
| `npm test` | 60 files, 539 tests passed (228 integration tests skipped without `TEST_DATABASE_URL`) |
| `npm run test:integration` (Neon test branch, one file at a time) | 22 files, 228 tests passed |
| `npm run security:sweep` (local production build) | 79 of 79 passed |

Findings fixed in this slice: **E1**, **A1**, **A2**, **A5**, **P1**, **P2**. Accepted by the owner
on 2026-11-12: **A3**, **A4**, **P3** (option a), **P4** (option 1 first).

## 1. End-to-end flows (plan §12)

The suite lives in `e2e/` and runs on Edge through `@playwright/test` 1.64.1. It uses the Neon
`e2e` branch (a child of `dev`, reset before each run), a dev server on :3100, the M-Pesa
simulator, local-disk storage, and development emails read from the server log. How to run it:
`docs/OPERATIONS.md` §8.

| # | Plan §12 flow | Test | What it proves |
|---|---|---|---|
| 1 | Visitor searches and opens a property | `visitor.spec` "searches, filters, sorts and opens a property" (desktop and mobile); "shows the not-found page for a listing that doesn't exist or isn't public" | Home search → results with no draft, pending or rejected samples. Rent filter plus price sort is in strict ascending order, with at most 3 cards in the labelled verified strip. The listing opens with price, photos and title. A draft listing's URL shows "Page not found" |
| 2 | Buyer registers and saves | `buyer.spec` "a buyer registers, confirms the email, and saves a listing" | Sign-up → confirmation link from the dev email → signed in. The database has a verified email and only `buyer_tenant`. Save → shows in Saved → unsave removes it |
| 3 | Agent subscribes, creates and submits | `journey.spec` step 3 | Agent sign-up and onboarding, Starter paid through the simulator (subscription `active`), basics, details, 5 described photos, submit → `pending_review` |
| 4 | Admin approves; listing appears | `journey.spec` step 4 | The admin queue → "Approve and publish" → `published`. An anonymous visitor finds it in search and opens its page |
| 5 | Agent buys verification and moves to the top | `journey.spec` step 5 | Verification paid (simulator), both required documents uploaded as PDFs, submitted. The admin ticks the 4-item checklist and approves. The card shows "Profile verified" and moves up the Recommended rent search. The ranking rule (verified tier first, at most 3 per lister) holds before and after. The labelled strip appears on the Newest sort |
| 6 | Buyer inquires; agent replies | `journey.spec` step 6 | A second buyer sends "Request a viewing". The agent opens the conversation and replies. The buyer's open thread shows the reply by polling |
| 7 | Plan lapses; listing pauses | `journey.spec` step 7 | The agent's plan period is moved 4 days into the past (3-day grace over) and `grace-expiry` runs with the real clock. The listing is `paused`, gone from search, its URL shows not found, and the agent's dashboard says paused |
| 8 | Invalid forms: accessible errors, values kept | `forms.spec` "sign-up: a bad email and a short password"; "lister forms: profile phone, listing basics, data request" (desktop and mobile) | Each bad field is `aria-invalid` with its error as its accessible description, focus moves to the first bad field, and typed values stay, selects and radios included, through two failed submits. The data-request radio group carries its error as its description. Passwords are not refilled (deliberate) |

**Suite stability.** It took eight runs to get a suite that runs clean every time. None of the
failures was an app bug:

- **Dev-server reload loop (runs 2, 4 and 6 hung in setup).** The e2e `next dev` recompiled after
  every request and the page under test reloaded endlessly. Three changes, in order:
  1. The suite's log, generated photos and admin login moved to the OS temp folder.
  2. Playwright's live traces and screenshots moved there too.
  3. Each run starts from a clean `.next-e2e` build folder. A persistent Turbopack cache left by
     an earlier run with older code was the remaining common factor.

  Runs 7, 8 and 9 logged no recompiles: each route compiled once. The exact trigger wasn't
  isolated. If the loop comes back, delete `.next-e2e` and rerun.
- **First compiles.** A setup step ("warm up the dev server's routes") requests every page the
  suite visits once before the tests start, so slow first compiles don't count against test
  timeouts.
- **Database outage (run 8).** The e2e branch in Frankfurt became unreachable mid-run. If a run
  fails with "Error connecting to database" in the server log, reset the branch and rerun.
- **Buyer race (run 3).** The test reloaded Saved before "remove" had finished. It now waits for
  the card to go.
- **Retries reused accounts.** A retry signed up the same email and, correctly, got no
  confirmation email. Each attempt now gets its own accounts.
- **Slow link (run 5).** Requests of 20 to 37 s timed out a few steps. The waits are now 60 s.
- **Another session committed favicon work on this branch during the runs.** Its `src/app/icon.svg`
  edits reloaded the dev server mid-run once.

Before the suite starts, global setup runs `grace-expiry` once. Dev never runs background jobs, so
this settles the branch to the real clock, and step 7 then changes only the e2e agent's plan.

### E1: lists lost their value after a failed submit (fixed)

**What.** React 19 resets a form after its Server Action returns. Text inputs re-render with the
submitted value as their default, so they survived. A `<select>` takes its `defaultValue` only when
it mounts, so the reset put **County** and **Bedrooms** back to "Choose". The controlled
**Property category** select was worse: the DOM showed "Choose a category" while React state still
said "House", so the next submit sent an empty category.

**Fix.** When an uncontrolled select's `defaultValue` changes, `src/components/ui/Select.tsx` now
marks that option as the form's default (`defaultSelected`) and selects it. React's reset then
restores the submitted choice. The element stays mounted, so keyboard focus isn't lost. A first
version remounted the select instead, which would have dropped focus (see A5). The fix covers
every form that uses `Select`: listing basics and details, the report forms, and the home
search. `BasicsForm` category is now uncontrolled; its state only drives which
fields show. **Proven by** `forms.spec` (County, Bedrooms, Category and the Sale radio all kept,
through two failed submits).

## 2. Accessibility audit

`e2e/a11y.spec.ts` checks every page below on desktop (1280px) and mobile (390px, touch). Each page
is checked fully before the test fails, so one run lists every problem.

- **Public and auth (15):**
  - home
  - search (default, rent + Newest with the verified strip, no results)
  - a listing
  - pricing, how it works
  - privacy, data request, terms, subscription policy, moderation
  - sign-in, sign-up, forgot password
- **Lister account (11):** home, onboarding, profile, listings, new listing, billing, checkout,
  verification, messages, saved, settings.
- **Admin (7, desktop):** overview, listings, verification, billing, jobs, reports, data requests.

| Check | How | Result |
|---|---|---|
| WCAG 2.1 A and AA | axe-core 4.14 with `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa` | 0 violations after A1. The Next.js dev-tools badge is excluded: it exists only in `next dev` |
| Contrast | axe `color-contrast` (part of the scan) | 0 violations |
| Labelled controls | axe `label`, `button-name`, `link-name`, `select-name` (part of the scan) | 0 violations |
| 320px width | The desktop run re-checks each page at 320px | No horizontal scroll |
| 200% zoom | The desktop run re-checks each page at 640px wide: 1280px at 200% | No horizontal scroll |
| Target size | Every visible control in the header and `main`. Height 44px (`h-control`), or 32px for the documented secondary controls (AGENTS.md §1). Width at least 24px (WCAG 2.2 AA 2.5.8). Inline links in running text are exempt (2.5.8), and invisible `::after` hit areas count | Passed after A2, with one documented exception (A4) |
| Skip link | First Tab on home, search and sign-in lands on "Skip to content"; Enter moves to `#main` | Passed |
| Visible focus | 40 Tab presses on home, search and sign-in; every stop shows an outline or ring on itself or its card or label | Passed |
| Sort control | Focus the Sort select, change it; the URL updates and focus stays on it | Passed after A5 |
| Menus and dialogs | Mobile menu (`<dialog>`) and filter sheet (popover) open with Enter and close with Escape, and focus returns to the opener. The account menu does the same with `aria-expanded` | Passed |
| Error messages | See flow 8 | Passed |
| Reduced motion, colour alone, screen reader | Manual; see "For you to check" | Not run by the suite |

### A1: pagination's disabled "Previous" (fixed)

axe `aria-prohibited-attr` (serious) on the first results page: the disabled "Previous page" was a
plain `<span>` with `aria-label`, which ARIA doesn't allow there. It is now
`role="link" aria-disabled="true"`, a disabled link that screen readers read as dimmed.

### A5: changing the sort dropped keyboard focus (fixed)

The search page keyed the results header by URL, so every sort change remounted the Sort select,
and focus fell back to the page. A keyboard user had to tab back from the top after each sort.
The header is no longer keyed: its only input, the Sort select, follows its default without a
remount (E1). **Proven by** `a11y.spec` "after a sort change, focus stays on the sort control".

### A2: reconciliation ids on the admin billing page (fixed)

The ids under "Nightly reconciliation" were 13px-tall text links. They are now 44px rows
(`min-h-control`).

### A3: every admin page is titled "Admin" (accepted, by design)

WCAG 2.4.2 prefers a descriptive title on each page. The neutral title is the S19 security fix F1:
page titles sit in the prerendered head, which a forged session cookie can fetch. The page heading
(`h1`) names each page. Keep as is.

### A4: "View all N photos" on the listing gallery is 32px (accepted, 2026-11-12)

It sits over the last mosaic tile, which is itself a full-size button that opens the same gallery.
It is listed with the other 32px secondary controls in `e2e/support/a11y.ts`. To make it 44px
instead, change `min-h-control-sm` to `min-h-control` in `src/components/listing/Gallery.tsx`.

## 3. Performance pass

### Layout shift and load: live site

Edge with a `PerformanceObserver` (`e2e/perf/web-vitals.ts`, 3 loads per page) and Lighthouse 13.5
in simulated-throttling mode (Moto G-class phone, 4× CPU, "slow 4G"). Page loads only, no sign-in.

| Page (live) | Device | Lighthouse score | LCP | TBT | CLS |
|---|---|---|---|---|---|
| Home | desktop | 87 | 0.8 s | 290 ms | 0.001 |
| Home | mobile | 59 | 2.9 s | 2.1 s | 0 |
| Search (rent) | desktop | 88 | 1.7 s | 170 ms | 0 |
| Search (rent) | mobile | 46 to 51 | 5.1 to 5.3 s | 1.8 to 2.8 s | 0.01 |
| Listing | desktop | 87 | 1.8 s | 130 ms | 0 |
| Listing | mobile | 65 | 1.5 s | 3.1 s | 0.022 |

Notes:

- This machine's link to Frankfurt runs at about 290 KB/s (2.3 Mbps), so the observer's LCP on
  this machine (7 to 20 s) mostly measures the link. Lighthouse's simulation models a standard
  network and is the number to compare. PageSpeed Insights (Google's servers) was over its keyless
  daily quota on the day.
- CLS is 0.05 at most, from the footer moving down as streamed search results arrive. Under target.

### P1: verified check evaluated several times per row (fixed)

`lister_verified_now()` is a SQL function, about 21 µs a call on the e2e branch (measured: 6,000
calls in 125 ms). The `matched` CTE computes it once, but Postgres inlined the CTE and repeated
the call in every tier sort key. `EXPLAIN VERBOSE` showed 15 references in the Recommended plan.
At 5,000 matching listings that is about 0.3 s per search.

**Fix.** The Recommended page query, the verified strip and the home featured section now use
`with matched as materialized (…)`, so the check runs once per row. The Recommended plan's
references dropped **15 → 1**, and execution on the e2e branch went from 1.8 ms to 1.1 ms. Strict
sorts were left alone: they reference the check at most 3 times and don't sort on it.

### Query plans

`node --conditions=react-server --import tsx e2e/perf/explain.ts` runs the app's own search and
home queries on the e2e branch (60 listings) under `EXPLAIN (ANALYZE, BUFFERS)`. Then it runs them
again with `enable_seqscan = off`, which shows whether an index exists for each table access.

| Query | Execution (e2e branch) | With seq scans priced out |
|---|---|---|
| Recommended (no filter; rent in Nairobi; buy 3+ beds with a price cap; page 2; verified only) | 0.8 to 1.3 ms | `properties_public_search_idx`, `lister_profiles_pkey`, `agencies_pkey`, `property_images_one_cover`, `property_images_property_sort_idx` |
| Newest and price sorts (page + strip) | 0.6 to 1.0 ms | Same indexes |
| Count query | under 0.1 ms | `properties_public_search_idx` |
| Home sections (4 queries) | 0.4 to 1.5 ms | Same indexes |

With 60 rows Postgres rightly seq-scans; the second pass shows an index path exists for every
table access. The location search `q` uses `ILIKE '%…%'` on county, town and neighbourhood. Only
`town` has a trigram index, so at scale it filters after the status index. That is fine at launch
volume (hundreds to low thousands of listings). Revisit with trigram indexes on `county` and
`neighbourhood` at around 10,000 published listings.

### Images

- Listing photos are served as stored WebP variants (480, 960 and 1600 px), chosen from each
  image's `sizes`. A mobile card loads the 960 variant (about 110 KB).
- The home hero uses `preload`. The listing gallery preloads its first photo.
- **P2 (fixed):** on mobile search, the LCP image is the first result's photo, and it was
  `loading="lazy"` with no priority. Lighthouse flagged "fetchpriority=high should be applied" and
  "should not use loading=lazy". The first result card is now `loading="eager"` with
  `fetchPriority="high"` (or the first verified-strip card when the strip shows). Next.js 16
  recommends that over `preload` when the LCP image depends on the viewport. Lighthouse's
  discovery checklist now passes. In A/B runs the simulated LCP didn't move (about 6.5 s both
  ways): the page waits on JavaScript (P4), not on finding the image.

### P3: Sentry's browser SDK (accepted, 2026-11-12: option a, keep as is)

Browser Sentry (S21) costs about **42 KB** of compressed JavaScript on every page: measured on
two local production builds, the same code with and without the browser init. Home went from
164 KB to 122 KB and the listing page from 195 KB to 153 KB. Its effect on TBT was within
run-to-run noise (search 1.0 vs 1.4 s, home 2.6 vs 2.3 s, listing 2.6 vs 0.9 s).

Tried and reverted: loading the SDK lazily after the page goes idle. A dynamic
`import("@sentry/nextjs")` pulls in the whole SDK and defeats tree-shaking. Home JavaScript rose
from 164 KB to 229 KB and TBT from 0.9 to 1.6 s.

Options:

- **(a) Keep as is (recommended for launch).** Browser error alerts stay on.
- **(b) Drop browser Sentry, keep server Sentry.** Saves about 42 KB per page, but errors that
  happen only in the browser go unreported.
- **(c) Revisit later.** Sentry's bundle-size options (`excludeTracing` and similar) currently work
  only with webpack. Check again when they support Turbopack.

### P4: mobile LCP above 2.5 s on search and the listing page (accepted, 2026-11-12: option 1 first)

Lighthouse's simulated mid-range phone puts search at about 5 to 6.5 s and the listing page at
1.5 to 3.5 s, depending on the run. The per-run breakdowns show the LCP photo is found early
(after P2). Paint waits on main-thread JavaScript: 1 to 3 s of total blocking time, from
hydrating React on a page of 12 photo cards. CLS and desktop are well inside target.

This is not a small fix. The options, from cheapest:

1. **Measure real users first.** Turn on Vercel Speed Insights (Vercel dashboard → project →
   Speed Insights). Lab numbers on a simulated slow phone overstate what most visitors see, and
   field data shows whether this matters for Kenyan users.
2. **Ship fewer, smaller photos on phones.** Add a 640 px variant and lazy-load cards past the
   first row.
3. **Hydrate less.** Turn the result cards into server components, so only the heart button
   hydrates. This is a refactor and needs its own slice.

Recommendation: do 1 now, and decide on 2 and 3 with the field data.

**Decision (2026-11-12):** option 1. Speed Insights needs both the dashboard switch and the
`@vercel/speed-insights` component in the root layout. That is a new third-party script, so it
gets its own small prompt rather than riding on this slice. Options 2 and 3 wait for the field
data.

## Decisions and remaining manual checks

1. **A4:** kept at 32px. **P3:** browser Sentry kept. **P4:** measure real users first (above).
2. **Manual checks** (10 minutes, still to do):
   - Turn off Windows animation effects (Settings → Accessibility → Visual effects) and browse
     home and a listing. Nothing should slide or fade.
   - With Narrator on Edge, open a search page and a listing. The page title, the "Profile
     verified" badge text, the card titles and the "Request a viewing" form should all be read.
   - On your phone, open a listing and the filter sheet. The phone has no Popover API, so this
     checks the fallback.
