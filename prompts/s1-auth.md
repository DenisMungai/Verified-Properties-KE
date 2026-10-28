# S1 — Authentication, accounts and design alignment

## Goal

1. **Design alignment.** Move the S0 foundation onto the new UI design in
   `design/VerifiedPropertiesKE-Full-UI-Design-System/`: its colour tokens and a **90% CSS root
   size**. Add the shared site header and footer from the design.
2. **Authentication and accounts** (plan v2.0 §9, "Authentication and accounts"):
   - Better Auth email and password sign-up, sign-in and sign-out
   - email verification and single-use password reset
   - return-to redirects
   - server-side roles and an operator-only admin script
   - lister onboarding and profile
   - a buyer account area
   - rate limits
3. **Carry-over tooling fixes** from S0 now that real Neon branches exist.

Billing, listings and favourites are **not** in this slice. The account area only shows what
already works.

## References read

- `AGENTS.md`, plan v2.0 §6 (roles), §9 (auth), §14 (authorization, accessibility, trust),
  §15 (authentication checklist)
- Design screens:
  - `1 - Design System & Components/`: design system sheet, buttons (Primary, Secondary, Quiet),
    Input - Location, Status badges, Accessibility principles
  - `2 - Public Pages/`: 01 Homepage (header), 04 Sign In, 05 Saved Properties, 06 Mobile Homepage
    (390px header)
  - `3 - Lister & Admin Dashboards/01 — Lister Dashboard` (account shell and sidebar)
- `node_modules/next/dist/docs/` for authentication with Cache Components
  (`01-app/02-guides/authentication-with-cache-components.md`), `proxy`, Server Actions, `cookies()`
- Better Auth 1.7.14 (`node_modules/better-auth` docs and types after install): Drizzle adapter,
  `nextCookies()`, `toNextJsHandler`, `getSessionCookie`, email verification and reset hooks
- Reference implementation: `../propertyhub-phase1-final/propertyhub/src/lib/auth.ts`,
  `src/lib/session.ts`, `src/lib/safe-redirect.ts` (+ test), `src/lib/rate-limit.ts`,
  `src/lib/mailer.ts`, `src/app/(auth)/*`, `scripts/create-admin.ts`

## Existing code and environment inspected

- S0 is committed (`ebf1774`). The UI kit, tokens, `env.ts`, `kenya.ts` and the schema
  (`users`, `sessions`, `accounts`, `verifications`, `user_roles`, `lister_profiles`, `agencies`,
  `agency_members`) are in place.
- **Neon:** the values live in `.env` (gitignored), not `.env.local`. Checked with names and
  read-only queries only:
  - `DATABASE_URL` uses the pooled host.
  - `DATABASE_URL_UNPOOLED` **also uses the pooled host** (same endpoint).
  - `TEST_DATABASE_URL` points at a different branch.
  - The dev branch already has both S0 migrations (Postgres 18.6, 19 tables, 0 rows).
  - I migrated the test branch and all **8 schema integration tests passed**. They needed a 30s
    timeout for Neon latency; that change is already made in `src/db/schema.integration.test.ts`.
- Empty in `.env`: `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`, `UPSTASH_REDIS_REST_*`.
- `drizzle.config.ts` loads only `.env.local`, and Vitest loads no env file, so `npm test` always
  skips the integration tests.

## Decisions and assumptions

### Design
1. **The new design folder replaces the old design-system markdown as the visual source of truth.**
   AGENTS.md §1 is updated to say so. The new token values:
   | Token (Tailwind name) | Old | New | Use |
   |---|---|---|---|
   | `emerald-600` (Forest / Primary) | #14833B | #14833B | primary buttons, links, logo |
   | `emerald-700` (Deep green) | #087443 | #087443 | hover, auth side panel, success text |
   | `mint-50` / `mint-100` (Soft green) | #F1F8F3 / #E4F2E8 | #E8F4EC / #DCEDE2 | quiet button, active nav, verified badge |
   | `canvas` (Warm canvas) | #F7F7F3 | #F7F8F5 | page background |
   | `ink` (Charcoal) | #171B22 | #17231D | body text **and headings** |
   | `slate-600` (Muted text) | #687280 | #647168 | supporting text (≈4.8:1 on canvas) |
   | `line` (Border) | #DCE4E2 | #E1E7E2 | borders |
   | `warning` | #A96508 | #B7791F | icons and tints only |
   | `danger` (Error) | #B42318 | #B42318 | errors |
   - **Navy is removed.** The design uses charcoal for headings and green for brand. Every
     `navy-*` usage moves to `ink` or `emerald-*`.
   - `#DCEDE2` for `mint-100` is derived (one step darker than Soft green) for hover and selected
     states.
   - `line-strong` becomes **`#8C968F`** (≈3.05:1 on white, ≈2.9:1 on canvas), used **only** for
     form-control borders (inputs, selects, textareas, the secondary button).
     - Why: WCAG 1.4.11 needs ≥3:1 for the boundary that identifies a control, and the design's
       #E1E7E2 is ≈1.3:1.
     - Effect: inputs will look slightly firmer than the mock. Cards and dividers keep #E1E7E2.
     - If you prefer the mock's lighter input border, say so and I'll use it and note the
       accessibility trade-off.
2. **Warning text stays dark.** `#B7791F` on white is ≈3.6:1, which fails AA for text. The design's
   "In review" badge therefore uses `#8A5206` text on a warning tint. Same rule as S0.
3. **90% root:** `html { font-size: 90%; }`, so body text is 14.4px at the browser default and
   everything rem-based scales with it. Two exceptions keep accessibility promises:
   - **Touch targets stay at 44 / 48 CSS px.** `control` and `control-lg` move to px values, so
     the 90% root does not shrink them to 39.6px. The design's own accessibility sheet requires a
     44px minimum.
   - Users who raise their browser font size still scale everything, because a percentage root
     respects the user's setting.
   - Accepted consequence: 12px tokens (label, caption) render at 10.8px. That follows the
     design's choice; I'll flag it in the hand-off and not change it.
4. **Design mock defects fixed, not copied.** In the Sign In mock, the side-panel paragraph
   overlaps the illustration, and the "Sign in" button has dark text on green. I build the
   intended layout: a readable white text block, the illustration below it, and white button text.
5. **Verified badge wording stays "Profile verified".** The design's "✓ Verified" chip conflicts
   with plan §5, which takes precedence. S1 has no listing cards, so this only affects the
   styleguide.
6. **Header** (Homepage, Saved and Sign In mocks):
   - white bar, 72px tall
   - green wordmark "VerifiedPropertiesKE"
   - nav: "Explore", which links to `/` until search ships in S7
   - signed out: "Log in" (secondary) and "Get started" (primary)
   - signed in: an account menu with name, Account, and Sign out (plus Admin for admins)
   - at 390px: wordmark plus a menu button that opens a full-width sheet
   - "How it works" and "For agents" are **left out** until those pages exist, because the plan
     allows no dead links
7. **Footer:** a minimal footer with the wordmark, copyright and only real links (Explore, Log in,
   Get started), on deep green or charcoal to match the design's tone.

### Auth model
8. **Better Auth** with the Drizzle adapter on the existing tables.
   - Map models to the plural table names (`user→users`, `session→sessions`, `account→accounts`,
     `verification→verifications`).
   - Use `nextCookies()` so Server Actions set cookies, and `telemetry: { enabled: false }`.
   - Session: 30-day expiry, refreshed daily, with cookie cache off so role and verification
     changes take effect at once.
   - **No schema change is expected.** If Better Auth 1.7.14 needs a column the S0 tables lack, add
     it through a new migration `0002_auth_adjustments` and say so.
9. **Email verification is required before sign-in** (`requireEmailVerification: true`). The
   verification link signs the user in and lands on `/account`, or on their `next` destination.
   Reset links expire after 1 hour and work once. Better Auth deletes the token on use; a test
   proves a second use fails.
10. **Sign-up asks one question:** "What brings you here?"
    - "Find a property" gives role `buyer_tenant` only.
    - "List property" also gives `buyer_tenant`, then sends the user through lister onboarding after
      verification.
    - Roles are always written by server code from an **allowlist**: `buyer_tenant` at sign-up;
      `agent` or `owner` when the lister profile is created (lister type agent → `agent`; owner or
      developer → `owner`).
    - `platform_admin`, `billing_admin` and `agency_admin` can **never** come from user input.
11. **Lister onboarding** at `/account/onboarding` collects lister type (agent / private owner /
    developer), display name, phone (normalised to E.164 by `normalizeKenyanPhone`), optional
    public email and optional bio. Avatar upload waits for R2 in S4. Agency membership is
    operator-managed for now, as in the plan.
12. **Return-to redirect:** `?next=` is accepted only if it is a same-origin relative path (starts
    with `/`, not `//` or `/\`, no scheme). Otherwise the user lands on `/account`. Adapted from the
    reference `safe-redirect.ts` with its tests.
13. **Rate limits** use `@upstash/ratelimit` + `@upstash/redis` when `UPSTASH_REDIS_REST_*` is set.
    - Limits: sign-in 5 per 15 min per IP+email and 20 per 15 min per IP; sign-up 5 per hour per
      IP; reset request 3 per hour per email and 10 per hour per IP; resend verification 3 per hour
      per email.
    - Without Upstash: an in-memory limiter in development, and in **production the actions refuse
      to run** with a clear server log naming the missing variables (never their values). Better
      Auth's own limiter stays on as a second layer.
14. **Email** (`src/lib/email/`) uses Resend when `RESEND_API_KEY` and `EMAIL_FROM` are set. In
    development without them, the email (recipient masked, link shown) is printed to the server
    console. **Production refuses to send without them.** Templates are plain, accessible HTML plus
    a text version, carrying no personal data beyond the first name.
15. **The reset request never reveals whether an account exists.** It always shows: "If an account
    exists for that email, we've sent a reset link." Sign-in failures always show "Email or
    password is incorrect" (an unverified account gets the "check your email" path, with a resend
    option).
16. **Route protection, two layers:**
    - `proxy.ts` does an optimistic cookie check (`getSessionCookie`) for `/account/**` and
      `/admin/**` and redirects to `/sign-in?next=…`.
    - Every protected page, Server Action and route then **re-checks the session and roles on the
      server** through `src/lib/session.ts` (`requireUser()`, `requireRole()`).
    - The proxy is never the only check.
17. **Cache Components:** anything reading the session (header account menu, account pages) is
    rendered inside `<Suspense>` with a skeleton fallback. Auth pages stay static shells.
18. **`/admin`** in S1 is only a protected placeholder page ("Admin console — moderation arrives in
    S8"). It proves `requireRole("platform_admin")`, and non-admins get a 404.
19. **`BETTER_AUTH_SECRET`:** during implementation I generate a 48-byte random secret and write it
    into your `.env`. The value is never printed and never committed.

### Tooling carry-over
20. `drizzle.config.ts` loads `.env.local`, then `.env` (`.env.local` wins).
    - New script `test:integration` runs only `*.integration.test.ts` with env loaded
      (`node --env-file-if-exists=.env --env-file-if-exists=.env.local …vitest run integration`).
    - `npm test` stays fast and skips them unless `TEST_DATABASE_URL` is exported.
    - `hookTimeout` is 30s in `vitest.config.mts`.
21. **I recommend changing `DATABASE_URL_UNPOOLED` to the direct host** (the same string without
    `-pooler`). Migrations through the pooler worked, but Neon advises direct connections for
    schema changes. You edit this; I don't write connection strings.

## Files likely to change

```text
AGENTS.md                        design source of truth → design/ folder; 90% root rule
tailwind.config.ts               new token values, navy removed, px control sizes
src/app/globals.css              90% root, new CSS variables
src/components/ui/*              navy → ink/emerald; Button gains "quiet" variant; Badge warning text
src/app/styleguide/*             reflect new tokens
src/components/layout/{SiteHeader,SiteFooter,MobileMenu,AccountMenu,Logo}.tsx
src/app/layout.tsx               header/footer with Suspense around the account menu
src/app/(auth)/{sign-in,sign-up,check-email,forgot-password,reset-password}/page.tsx
src/app/(auth)/actions.ts        Server Actions wrapping Better Auth with Zod + rate limits
src/components/auth/{AuthShell,SignInForm,SignUpForm,ForgotPasswordForm,ResetPasswordForm}.tsx
src/app/api/auth/[...all]/route.ts
src/proxy.ts
src/app/account/{layout,page}.tsx, account/onboarding/page.tsx, account/settings/page.tsx,
  account/saved/page.tsx, account/actions.ts
src/components/account/{AccountNav,ListerProfileForm}.tsx
src/app/admin/page.tsx
src/lib/auth.ts, src/lib/auth-client.ts, src/lib/session.ts, src/lib/roles.ts
src/lib/safe-redirect.ts (+test), src/lib/rate-limit.ts (+test), src/lib/email/{send,templates}.ts (+test)
src/lib/validation/{auth,profile}.ts (+tests)
src/db/queries/{users,lister-profiles}.ts (+ integration test)
scripts/create-admin.ts
drizzle.config.ts, vitest.config.mts, package.json, .env.example, README.md
```

## Implementation requirements

### Design alignment
- Update tokens, CSS variables and the styleguide swatches to the table above. Replace every
  `navy-*` class. The styleguide shows the 90% root note ("Base body 14.4px at 16px browser
  default").
- Button variants follow the design:
  - **primary:** Forest background, white text, 12px radius
  - **secondary:** white background, border, charcoal text
  - **quiet** (new): Soft green background, deep green text, e.g. "Save property"
  - **ghost** and **danger** stay
- Input follows "Input - Location" (12px radius, white, 1px border).
- The status badges match the design's pill tints ("Verified" pattern, "In review", "Needs
  action"), keeping the plan's wording rules.
- Header, footer and mobile menu as in decisions 6–7. The mobile sheet traps focus, closes on Esc
  and on route change, returns focus to the trigger, and its button has
  `aria-expanded`/`aria-controls`. Active nav item uses `aria-current="page"`.

### Auth pages (match "04 — Sign In - Desktop")
- **AuthShell, at `lg` and up:**
  - two columns
  - left: Deep green panel with the white wordmark, headline "Your next chapter starts with a
    place." (white, h1 weight), a supporting line "Save homes you love, manage enquiries and connect
    with reviewed property professionals." (white/90), a simple house illustration built from
    tinted rounded rectangles like the mock (decorative, `aria-hidden`), and a check list "Clear
    listings · Reviewed listers · Better decisions"
  - right: canvas background with the form at max width 32rem
- **AuthShell below `lg`:** the form only, with the wordmark above it.
- **Sign in:** "Welcome back" / "Sign in to continue to your account.", email and password fields,
  a "Forgot password?" link, a full-width primary "Sign in" button, and "New here? Create an
  account" (keeps `next`).
- **Sign up:** "Create your account", full name, email, password (min 10 characters, max 128,
  strength hint, a show/hide toggle with an accessible label), the "What brings you here?"
  segmented control (Find a property / List property), and a terms notice as plain text (terms
  pages come in Phase 4).
- **Check email:** explains the verification link, with a "Resend email" action (rate-limited) and a
  generic response.
- **Forgot password:** sends a reset link; reset password sets a new password and confirms it.
- Forms are Server Actions with `useActionState`. Field errors come inline from Zod. The form keeps
  submitted values except passwords. A pending submit shows the Button loading state. The first
  invalid field gets focus after a failed submit, and a summary is announced through
  `aria-live`.

### Account area (match "01 — Lister Dashboard" shell)
- **`/account` layout:**
  - left sidebar on `lg` (Overview, Saved properties, Settings, plus "Listing profile" for
    listers); an active item has a Soft green background and Forest text
  - on mobile, a horizontal scrollable tab list
  - top bar uses the site header
- **Overview:**
  - greeting "Good morning/afternoon/evening, {first name}" in Nairobi time
  - buyers see an EmptyState card: "Saved homes will appear here" linking to Explore
  - listers see a profile summary card, and a "Finish your listing profile" prompt if onboarding is
    incomplete
  - **No stat cards with invented numbers.** Listing and billing stats arrive with their slices.
- **Saved properties:** heading and tabs from mock 05 ("All saved (0)" only; "Recently viewed" and
  "Search alerts" are left out until built), and an EmptyState.
- **Settings:** name, email (read-only, with verification status), change password (current and
  new, revoke other sessions), sign out of all devices.
- **Onboarding and listing profile:** `ListerProfileForm` (decision 11). Saving creates or updates
  `lister_profiles` and assigns the role allowlisted for the lister type, in one transaction.

### Server
- `src/lib/auth.ts` (server-only) configures Better Auth (decisions 8–9, 14) with
  `baseURL = NEXT_PUBLIC_APP_URL`, and trusted origins set to the app URL only.
- `src/lib/session.ts`:
  - `getSession()` (cached per request with React `cache`)
  - `requireUser({ next })`, which redirects to sign-in
  - `requireVerifiedUser()`
  - `getRoles(userId)`, `requireRole(...roles)`, which calls `notFound()` for the wrong role
- `src/lib/roles.ts`: role constants, the self-service allowlist, and the lister type → role map.
- `scripts/create-admin.ts`: `npm run admin:create -- someone@example.com`.
  - Needs `ADMIN_CREATE_CONFIRM=yes`.
  - Refuses if the user doesn't exist or isn't verified.
  - Grants `platform_admin`, or `billing_admin` with `--role billing_admin`.
  - Idempotent. Prints the masked email only.
- Remove the S0 placeholder home's "Foundation build" eyebrow. Home stays a placeholder until S7,
  but uses the design's hero copy ("Find a place to call your own.") and links to Get started.

## Security requirements

- Passwords use Better Auth's hashing and are never logged. No secrets, tokens or full emails in
  logs; use masked emails.
- Every Server Action:
  1. Validates with Zod.
  2. Checks the session (except the public auth actions).
  3. Applies the rate limit.
  4. Returns typed `{ ok: false, fieldErrors | formError }` results with no stack traces.
- Roles come only from the allowlist. Any client-submitted `role`, `roles`, `emailVerified` or
  admin field is ignored (and covered by a test).
- `next` redirects only to same-origin relative paths. Tests cover `//evil.com`, `/\evil.com`,
  `https://evil.com`, `javascript:` and encoded variants.
- Sign-in errors and reset responses don't reveal whether an account exists.
- Cookies are httpOnly, SameSite=Lax, and Secure in production (Better Auth defaults, asserted in
  config). CSRF protection is Better Auth's origin check plus Server Actions' built-in origin check.
- `/admin` returns 404 for non-admins. The proxy is optimistic only.
- `BETTER_AUTH_SECRET` is required at runtime by auth code. A missing secret fails with a clear
  message naming the variable.

## Acceptance criteria

1. `typecheck`, `lint`, `test`, `build` and `test:integration` all pass. The build has no
   blocking-route Cache Components errors.
2. Sign-up → verification email (console in dev) → link → signed in at `/account`. Before
   verifying, sign-in shows the check-email path, not a session.
3. A sign-in from `/sign-in?next=/account/settings` lands on Settings. `next=//evil.com` lands on
   `/account`.
4. A forgotten password shows the generic message whether or not the account exists. The reset
   link works once; a second use shows "This link has expired or was already used."
5. A "List property" sign-up goes through onboarding. Saving creates `lister_profiles` with an
   E.164 phone and the `agent` or `owner` role. A forged `role=platform_admin` field changes
   nothing (test).
6. Signed out, `/account` and `/admin` redirect to sign-in. Signed-in non-admins get 404 on
   `/admin`. After `npm run admin:create`, the same user sees the admin placeholder.
7. The 6th rapid sign-in attempt for one email gets "Too many attempts. Try again in N minutes."
8. Header: signed out shows Log in and Get started; signed in shows the account menu. The mobile
   menu works by keyboard (Tab, Esc) at 390px.
9. Design check at 1440, 1280 and 390px:
   - computed root font size is 14.4px
   - controls are ≥44px tall
   - no horizontal overflow
   - no console errors
   - text contrast ≥4.5:1 (spot-checked on muted text, the warning badge and button text)
10. Unit tests cover:
    - safe-redirect cases
    - auth and profile Zod schemas (password length, Kenyan phone, display name)
    - role allowlist and lister-type mapping
    - rate-limit key building and the in-memory limiter
    - email dev fallback and production refusal
    - the greeting by Nairobi hour
11. Integration tests (test branch) cover: profile save creates the role in one transaction; a
    forged role is ignored; `create-admin` is idempotent; the reset token works once.

## Checks to run

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration   # Neon test branch from .env
npm run build
npx drizzle-kit generate   # expect "No schema changes" unless 0002_auth_adjustments was needed
```

Plus a browser pass at 1440, 1280 and 390px (Edge via Playwright).

## Manual test steps (after implementation)

1. Optional but recommended: in `.env`, change `DATABASE_URL_UNPOOLED` to the direct host (remove
   `-pooler`). If a `0002` migration was added, run `npm run db:migrate`.
2. `npm run dev`, open `http://localhost:3000`, then click **Get started**.
3. Create an account choosing **List property**. Watch the dev server terminal for the
   verification email and open the link.
4. Complete onboarding with phone `0712 345 678`. Check Overview and **Listing profile**.
5. Sign out, then try `/account/settings`. You should be sent to sign-in and come back to Settings
   afterwards.
6. Use **Forgot password**. The terminal shows the link. Reset, then open the same link again: it
   must be rejected.
7. Enter a wrong password 6 times quickly. The 6th attempt must be blocked.
8. `ADMIN_CREATE_CONFIRM=yes npm run admin:create -- you@example.com` (PowerShell:
   `$env:ADMIN_CREATE_CONFIRM="yes"; npm run admin:create -- you@example.com`), then open
   `/admin`.
9. Resize to 390px: open the menu, Tab through it, press Esc.
10. For real email and shared rate limits, set `RESEND_API_KEY`, `EMAIL_FROM` and
    `UPSTASH_REDIS_REST_URL` / `_TOKEN` in `.env` and repeat step 3.
