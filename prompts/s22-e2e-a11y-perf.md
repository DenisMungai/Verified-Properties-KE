# S22 End-to-end flows, accessibility and performance (Phase 4, part 4)

## Goal

Tick the last "Quality and operations" items of plan §12 with evidence, and the launch-checklist
line "Mobile, accessibility and security checks complete" (§15 Operations):

1. **Playwright end-to-end flows** (plan §12), committed as a repeatable suite under `e2e/`:
   1. a visitor searches and opens a property
   2. a buyer registers (email link from the dev log) and saves a property
   3. an agent subscribes, creates a listing and submits it
   4. an admin approves it and the listing appears in search
   5. the agent buys verification, uploads documents, is approved and moves to the top
   6. a buyer inquires and the agent replies
   7. the agent's plan lapses and the listing pauses (hidden from search)
   8. invalid forms show accessible errors and keep the typed values

   The Mobile List-to-Map flow is dropped with Phase 3.
2. **Accessibility audit**, automated where a tool can judge and written down where a person must:
   axe-core WCAG 2.1 AA scan, keyboard access, visible focus, contrast, labelled controls, 44px
   targets, 200% zoom and 320px width. Real problems found are fixed in this slice.
3. **Performance pass** on images, query plans (the Recommended ranking query first) and layout
   shift, measured on the live site and on the e2e build. Real problems found are fixed in this
   slice.

Results go in `docs/QUALITY_REPORT.md`: one table per area, each line a check, its result and
its evidence (spec name, scan output, EXPLAIN plan, measured number).

**Out of scope:**
- running e2e in GitHub Actions (the app needs Neon; CI has only a plain Postgres service). The
  suite runs locally on demand; CI gains nothing new except typecheck/lint of `e2e/`.
- visual-regression screenshots
- load testing
- new features or redesigns. Fixes stay as small as the finding.

## References read

- `docs/implementation-plan-v2.md`:
  - §12 Quality and operations: the Playwright flow list, the accessibility audit list, the
    performance pass ("images, query plans (ranking query especially) and layout shift")
  - §14 Accessibility row: keyboard, visible focus, WCAG AA contrast, 44px targets, text or icons
    alongside colour, reduced motion; the verified tick has a text label
  - §15 Operations: "Mobile, accessibility and security checks complete"
- `prompts/s19-security-audit.md`: Phase 4 slice table (S22 needs nothing from you)
- `prompts/ui-compact-design-system.md`, `prompts/ui-mobile-optimization.md`: 44px `h-control`,
  32px `control-sm` secondary controls, 16px phone inputs, `data-mobile-bar`
- `AGENTS.md` §1 design rules (touch targets, contrast tokens, `warning-text`), §8, §9
- `docs/PHASE2_REPORT.md`: how the exit walkthroughs drove Edge, the simulator and the dev log
- Memory `local-env-browser-db`:
  - no Chrome; Edge works through Playwright with `channel: "msedge"`, version 1.56.1 or later
  - dev email links come from the dev server log
  - simulator mode needs empty Daraja credentials in the process env
  - fake `x-forwarded-for` must be added with `context.route`, never `extraHTTPHeaders`
  - soft 404s: check page text, not status; Next keeps old routes mounted as hidden
    `<Activity>`, so use `:visible`
  - the local link to Frankfurt drops connections at times; Frankfurt round trips are slow
- Next docs: `01-app/02-guides/upgrading/version-16.md` (dev and build use separate output
  folders and a lockfile stops a second `next dev` in the same project)

## Existing code inspected

- **Pages:** 45 `page.tsx` routes (public, auth, account, admin). The axe scan list below covers
  every public and auth page plus the main account and admin pages.
- **Skip link:** `src/app/layout.tsx:31` "Skip to content" exists.
- **Email:** `src/lib/email/send.ts` prints the first link of each email to the console in
  development without Resend (recipient masked). Production refuses to send.
- **Payments:** `src/lib/mpesa/simulator.ts` (dev only, refuses `NODE_ENV=production`);
  `npm run mpesa:simulate` posts the callback to the real route. So e2e must run on `next dev`,
  not a production build.
- **Jobs:** `scripts/jobs-run.ts` runs a job through `runJob(...)` without QStash, with an
  optional fake clock (`JOBS_FAKE_CLOCK_CONFIRM`).
- **Roles:** `src/lib/admin-grant.ts` `grantOperatorRole(db, email, role)`: operator-only, needs a
  verified email.
- **Rate limits:** `src/lib/rate-limit.ts` uses Upstash when configured, and fails closed without
  it outside development.
- **Storage:** with the `STORAGE_*` variables empty, development uses the local disk store
  (`.data/storage/`).
- **Ranking:** `src/db/queries/public-listings.ts` `searchListings` and `homeSections`, ordered by
  `src/db/queries/ranking.ts` (`verifiedTierOrderBy`, `scoreSql`, `rotationKey`).
- **Images:** 5 files use `next/image`; `PhotoManager.tsx` uses a plain `<img>` for upload
  previews (blob URLs, which is fine).
- **CI:** `.github/workflows/ci.yml` runs typecheck, lint, migrations, unit tests and build. No
  Neon secrets, so it can't run the app against a real database.

## Decisions and assumptions

1. **Database target: a dedicated Neon `e2e` branch, child of `dev`, reset from `dev` before each
   run.** Runs never write to `dev` or production; the lapse flow and its fake clock can't pause
   real dev listings; each run starts from the same seeded state. I create the branch once
   through the Neon tools with your OK (one non-destructive create). The run's setup resets it
   from its parent; nothing else in Neon is touched.
   - The connection strings go in `.env.local` as `E2E_DATABASE_URL` and
     `E2E_DATABASE_URL_UNPOOLED`.
   - Every e2e helper that writes to the database first checks the host's first label against
     the `E2E_DATABASE_URL` host and refuses anything else (dev, test, production).
   - *Alternative you can pick instead:* run on `dev` with `e2e+<run>@example.test` accounts and
     no fake clock (the lapse flow backdates only the e2e agent's subscription). Cheaper, but
     every run leaves accounts and listings on dev.
2. **Server: the suite starts its own `next dev` on port 3100,** with a separate output folder so
   it can run next to your own `next dev` on :3000. This needs one small config change:
   `distDir` read from `NEXT_DIST_DIR` (default `.next`, so nothing changes for you or Vercel).
   If the lockfile still blocks a second dev server, the fallback is to stop yours during an e2e
   run, written in the run steps. The e2e server's environment overrides:
   - `DATABASE_URL` / `DATABASE_URL_UNPOOLED` → the e2e branch
   - Daraja credentials empty → simulator; `MPESA_CALLBACK_BASE_URL=http://localhost:3100`
   - `STORAGE_*` empty → local disk store under `.data/e2e-storage/`
   - `UPSTASH_*` empty → in-memory development limiter; `RESEND_API_KEY` empty → emails logged
   - `QSTASH_*`, `NEXT_PUBLIC_SENTRY_DSN`, `PAYSTACK_SECRET_KEY` empty (no jobs, no Sentry, no
     card)
3. **Email links:** a small launcher script (`e2e/server.mjs`) starts `next dev` and copies its
   output to `.data/e2e/server.log`. Tests read the newest link after their action. No app code
   changes for email.
4. **Admin account:** the global setup signs up `e2e-admin@example.test` through the UI, confirms
   it from the log, and grants `platform_admin` with `grantOperatorRole` against the e2e branch
   only (guarded as in decision 1). This is the same path as `npm run admin:create`, and it never
   touches dev or production.
5. **Payments** go through the simulator: the test clicks Pay, then runs the same code as
   `npm run mpesa:simulate` for that checkout, and waits for the page to show the plan as active.
   Card payments are not exercised (Paystack is optional and has its own tests).
6. **Jobs:** the lapse flow backdates the e2e agent's listing plan to end four days ago (past the
   3-day grace), then runs `grace-expiry` through `runJob` with the real clock. No fake clock is
   needed, so other subscriptions on the branch stay as they are.
7. **Suite shape:** `@playwright/test` (devDependency; plan §4 lists Playwright from Phase 4) and
   `@axe-core/playwright` (devDependency), Edge (`channel: "msedge"`), one worker.
   - `e2e/journey.spec.ts`: flows 3 to 7 as one `test.describe.serial` journey, because each
     step needs the last
   - `e2e/visitor.spec.ts` (flow 1), `e2e/buyer.spec.ts` (flow 2), `e2e/forms.spec.ts` (flow 8),
     `e2e/a11y.spec.ts` (scans)
   - `npm run e2e` runs everything; `npm run e2e -- <file>` runs one file
   - the tests use roles, labels and visible text, never CSS classes
   - generous timeouts (Frankfurt), and one retry for network-only failures
   - each run uses fresh fake client IPs through `context.route` (sign-up limit is per IP)
8. **Accessibility audit:**
   - **Automated (`e2e/a11y.spec.ts`).** axe-core with the `wcag2a`, `wcag2aa`, `wcag21a` and
     `wcag21aa` tags on: home, search (with and without results), a listing, pricing, how it
     works, privacy, terms, subscription policy, moderation, sign-in, sign-up, forgot password,
     account home, billing, my listings, the listing editor, messages, verification, admin home,
     admin listings and admin verification. The test fails on any violation. Known, accepted
     exceptions are listed in the spec by rule and selector with a reason; none are expected.
   - **Automated layout checks** on the same pages:
     - at 320px wide, no horizontal page scroll
     - at 1280px with 200% zoom (a 640px CSS viewport, with browser zoom where Playwright
       supports it), no horizontal scroll and no clipped controls
     - every visible button, link, input and select in `main` and the header is at least 44×44px,
       except the documented 32px secondary controls (pagination, toolbar selects, card heart,
       chip remove) and inline text links in paragraphs
   - **Keyboard and focus (scripted).**
     - Tab from the top of home, search and sign-in. The skip link comes first and works.
     - Every focused element shows a visible focus style (a computed outline or ring that isn't
       `none`).
     - Menus, the filter sheet and dialogs open and close with the keyboard, and focus returns
       to the opener.
   - **Manual, written down in the report:** reduced motion, colour not used alone (the verified
     badge has its text label), and a short screen-reader pass of the search and listing pages
     with Narrator on Edge.
9. **Performance pass:**
   - **Layout shift and load:** Playwright on the live site (read-only page loads, no sign-in)
     and on the e2e server, mobile (390px, 4x slowdown) and desktop. Records LCP and CLS with a
     `PerformanceObserver` on home, search and a listing page. Targets: CLS < 0.1, LCP < 2.5s on
     the live site. A miss is investigated and fixed when the cause is in our code (missing
     image sizes, late-loading fonts, a hero or LCP image without priority, skeletons whose size
     changes).
   - **Images:** check that every `next/image` has `sizes` matching its grid, that only the
     first visible card image or hero is `priority`, and that the listing photos served are the
     WebP variants at the right width.
   - **Query plans:** `EXPLAIN (ANALYZE, BUFFERS)` on the e2e branch (never production) for:
     - Recommended search with no filters and with a county filter
     - Newest and price sorts
     - the home sections and the verified strip

     Each plan is recorded in the report. If a plan seq-scans `listings` where an index fits,
     or the ranking adds a big sort step, the fix is an index in a migration (generated with
     `npm run db:generate`). Dev seed data is small, so the plans are read for shape (index use,
     row estimates), not timing alone.
10. **Findings and fixes:** each finding gets an id (A1, P1, E1) in the report, with severity and
    the fix commit. Anything not worth fixing before launch is listed as accepted, with a reason,
    for you to confirm.

## Files likely to change

- `package.json`, `package-lock.json`: `@playwright/test`, `@axe-core/playwright`; scripts `e2e`,
  `e2e:report`
- `playwright.config.ts` (new)
- `e2e/` (new):
  - `server.mjs`: the dev-server launcher and log copy
  - `global-setup.ts`: branch reset, admin, guard
  - `helpers/`: db guard, email link, simulator payment, client IP, jobs
  - specs: `journey`, `visitor`, `buyer`, `forms`, `a11y`
- `next.config.ts`: `distDir` from `NEXT_DIST_DIR`
- `tsconfig.json` / `eslint.config.mjs`: include `e2e/` in typecheck and lint
- `.gitignore`: `test-results/`, `playwright-report/`, `.data/e2e*`, `.next-e2e/`
- `.env.example`: `E2E_DATABASE_URL`, `E2E_DATABASE_URL_UNPOOLED` (placeholders)
- `vitest.config.mts`: make sure `e2e/` isn't picked up by Vitest
- `docs/QUALITY_REPORT.md` (new); `docs/OPERATIONS.md`: a short "Running the e2e suite" section
- fixes found by the audit: likely small edits in `src/components/**` (labels, focus styles,
  target sizes, image `sizes`) and possibly one index migration in `drizzle/`

## Implementation requirements

1. Read the Playwright and axe-core package docs for the installed versions before writing
   config. Pin exact versions in `package.json` (Playwright 1.56.1 or later; check that Edge
   launches).
2. `playwright.config.ts`:
   - `testDir: "e2e"`, `workers: 1`, `fullyParallel: false`, `retries: 1`
   - `use: { baseURL: "http://localhost:3100", channel: "msedge", trace: "retain-on-failure" }`
   - projects `desktop` (1280×800) and `mobile` (390×844, touch). The journey runs on desktop
     only; the a11y and visitor specs run on both.
   - `webServer` runs `node e2e/server.mjs` with `reuseExistingServer: false` and a 180s timeout.
3. `e2e/server.mjs` loads `.env` and `.env.local` the same way the app does, applies the
   overrides from decision 2, refuses to start unless `E2E_DATABASE_URL` is set and differs from
   `DATABASE_URL`, and starts `next dev -p 3100` with `NEXT_DIST_DIR=.next-e2e`. It writes output
   to `.data/e2e/server.log`, starting a new file each run.
4. Global setup:
   - check the e2e host guard
   - reset the `e2e` branch from its parent through the Neon API (`NEON_API_KEY`, server-side
     only, in `.env.local`; if absent, print the manual reset step and stop)
   - apply migrations to the branch
   - create the admin account (decision 4)
   - record a run id used in every e2e email and listing title
5. Each flow checks what the user sees and, where the plan rule is about data, one targeted DB
   read through the guarded helper (for example, the listing status is `paused` after the lapse).
6. Flow details:
   - **1 Visitor:** home → search "Nairobi" → filter → sort → open a card → see the price, photos
     and lister. Then open a listing that doesn't exist and see the not-found text.
   - **2 Buyer:** sign up → check email → follow the link → signed in → save a listing → it
     shows in Saved → unsave.
   - **3 Agent:** sign up as agent → onboarding → pricing → Starter → simulated payment → plan
     active → new listing (basics, details, 5 photos from `scripts/seed-assets`) → submit →
     `pending_review`.
   - **4 Admin:** admin listings queue → approve → the listing shows in search for its town.
   - **5 Verification:**
     - agent pays for verification (simulated) and uploads the documents for their lister type
     - admin approves the review
     - "Profile verified" shows on the card
     - the listing is #1 in Recommended for a search that matches it
     - the verified strip shows it on a Newest sort
   - **6 Messaging:** a second buyer inquires from the listing page → the agent sees the
     conversation and replies → the buyer sees the reply (polling, with a 60s wait).
   - **7 Lapse:** backdate the agent's listing plan → run `grace-expiry` → the listing is
     `paused`, gone from search, and the agent's dashboard shows it paused with a renew prompt.
   - **8 Forms:** sign-up with a bad email and a short password, listing basics with a negative
     price, profile with a bad phone, and the data-request form. For each: the error is announced
     (`role="alert"` or `aria-describedby` on the field), focus or `aria-invalid` marks the
     field, and the typed values are still there.
7. Fixes follow `AGENTS.md` design rules: tokens only, the six type sizes, `h-control` targets,
   no new colours. Each fix is checked by re-running the spec that found it.
8. The report gives, for each plan §12 Quality item, the evidence and pass or fail.

## Security requirements

- Test helpers that write to a database refuse every host except the e2e branch. The host label
  is checked before connecting, not after.
- No secrets in specs, the report, traces or the committed config. `NEON_API_KEY` and the e2e
  URLs stay in `.env.local`. Playwright traces and reports are gitignored.
- The live-site performance runs are page loads only: no sign-in, no forms, no payments.
- The `distDir` change must not alter the Vercel build (unset means `.next`).
- The e2e branch is never promoted, never used by Vercel, and holds only seed data plus
  `@example.test` accounts.
- No production `EXPLAIN ANALYZE` (it executes the query); plans are taken on the e2e branch.

## Acceptance criteria

- `npm run e2e` passes all specs on Edge, desktop and mobile projects, from a fresh reset, twice
  in a row (the second run proves the reset and the run-id isolation).
- Every plan §12 flow (except the dropped Map flow) maps to a named passing test in the report.
- axe reports zero WCAG 2.1 A/AA violations on the listed pages, or each remaining one is an
  accepted exception you've confirmed.
- No horizontal scroll at 320px or at 200% zoom on the listed pages. Every interactive control
  meets 44px or a documented 32px exception. A visible focus style shows on every focusable
  element reached in the keyboard pass.
- Live-site CLS < 0.1 and LCP < 2.5s on home, search and listing (desktop and mobile), or a
  finding explains the miss and the fix.
- Each ranking query plan is recorded. No seq scan of `listings` remains where an index fits.
- `typecheck`, `lint`, `test` and `build` pass. Vercel builds unchanged.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration`, only if a migration or query changes
- `npm run build` (config and possibly components change)
- `npm run e2e`, twice
- `npm run security:sweep` (new files must not trip it)

## Manual test steps (after implementation)

1. Put `E2E_DATABASE_URL`, `E2E_DATABASE_URL_UNPOOLED` and `NEON_API_KEY` in `.env.local` (I give
   you the branch's strings after creating it).
2. Your own `npm run dev` on :3000 can keep running. If the e2e server says another dev server
   holds the lock, stop yours for the run.
3. Run `npm run e2e`. It resets the e2e branch, starts the server on :3100 and runs every spec.
   This takes a while; watch the terminal.
4. Run `npm run e2e:report` to open the HTML report. A failed test has a trace you can step
   through.
5. Run one file: `npm run e2e -- e2e/journey.spec.ts`.
6. Read `docs/QUALITY_REPORT.md`, and confirm or reject any "accepted" finding.
7. Optional manual checks from the report:
   - turn off Windows "Animation effects" (Settings → Accessibility → Visual effects) and
     browse home and a listing
   - try Narrator on a search page

## Amendments during implementation

1. **Branch reset.** Global setup resets the e2e branch through the Neon API when `NEON_API_KEY`,
   `E2E_NEON_PROJECT_ID` and `E2E_NEON_BRANCH_ID` are set. Otherwise it stops, unless
   `E2E_SKIP_RESET=yes` says the branch was reset by hand. No key was set during this slice, so
   I reset the branch with the Neon tools before each recorded run.
2. **Storage.** The e2e server uses the standard dev disk store (`.data/storage/`), not a separate
   folder. Keys are unique per upload, so sharing it with your dev server is harmless.
3. **`tsconfig.json`** gains the `.next-e2e` type paths. Next adds them on the first e2e start, so
   they are committed rather than rewritten each run.
4. **Photos.** The seed assets are below the 800 × 600 minimum (the app refused them, correctly),
   so the journey draws five 1200 × 800 JPEGs with `sharp`.
5. **`playwright-core` override (1.64.1).** `@axe-core/playwright` otherwise pulled 1.65.0, and
   the two copies' types clash.
6. **Global setup runs `grace-expiry` once,** so step 7 only lapses the e2e agent's plan. Dev never
   runs jobs.
7. **Target size rule.** Height follows AGENTS.md §1 (44px, or 32px for documented secondary
   controls). Width follows WCAG 2.2 AA (24px). Invisible `::after` hit areas count. Checking
   width against 44px would have flagged every short nav word ("Home" is 37px wide), which the
   project rule doesn't ask for.
8. **Sentry lazy-loading was tried and reverted** (report P3). It made bundles bigger. A
   measurement-only build without browser Sentry put its cost at about 42 KB per page. The choice
   is yours.
9. **Admin page titles** stay "Admin" (report A3): the generic title is the S19 F1 security fix.
10. **`useFakeIp` is renamed `withFakeIp`,** and the fixture callback `use` is named `provide`, so
    the React hooks lint rule leaves them alone.
11. **The suite's working files live in the OS temp folder** (`%TEMP%\verifiedpropertieske-e2e`:
    server log, generated photos, admin login state, and Playwright's per-test traces and
    screenshots), not `.data/e2e/` or `test-results/`. The dev server watches the project folder.
    Files written there while a test ran made it recompile and reload the page in a loop, which
    hung runs 2 and 4 in setup. The log was moved first; the traces after run 4.
12. **`gotoReady`** waits for the network to go quiet before a test fills a form. It was added for
    a suspected hydration race that turned out to be the reload loop (11), and it stays as a
    guard. A separate check showed sign-up works before hydration (native POST).
13. **E1's fix changed from a remount key to a default-sync effect** in `Select` (the remount
    would have dropped focus). That exposed **A5**: the search results header was keyed by URL,
    so a sort change lost focus. The key is removed.
14. **Retries get fresh accounts.** Each worker process adds a token to e2e emails and titles. A
    retry signing up the same email gets no confirmation email (correct anti-enumeration).
15. **Another session committed favicon work on this branch** during the slice (`0008a7e`,
    `537be45`, `94f40a8`, pushed to `origin/s22-e2e-a11y-perf`). It touches only the icon files
    and their prompts. Its `src/app/icon.svg` edits reloaded the e2e dev server mid-run.
16. **Timeouts raised to 60 s** (expect and actions) after run 5. Several requests took 20 to
    37 s over the Kenya–Frankfurt link, which timed out a few steps (the retries passed or failed
    on the same slowness).
17. **The e2e server deletes `.next-e2e` before it starts.** After runs 4 and 6 hung in the same
    reload loop with the log and traces already outside the project, a persistent Turbopack cache
    from earlier runs was the remaining common factor. With a clean folder, runs 7 and 8 logged
    zero recompiles. The exact trigger wasn't isolated.
18. **Route warm-up in setup.** `e2e/admin.setup.ts` requests every page the suite visits once
    before the specs, so first compiles on the dev server don't eat into test timeouts.
19. **Run 8 lost the database mid-run** (Frankfurt unreachable from 20:48; every query "fetch
    failed"). It is recorded as an environment failure. Run 9, from a fresh reset, is the second
    clean run the acceptance criteria ask for.
