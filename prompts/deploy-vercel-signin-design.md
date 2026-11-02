# Deploy to Vercel + sign-in page matching design "04 — Sign In"

## Goal

1. Make the sign-in page (and the other `AuthShell` pages) match
   `design/VerifiedPropertiesKE-Full-UI-Design-System/VerifiedPropertiesKE - Full UI Design System/2 - Public Pages/04 — Sign In - Desktop.png`:
   solid white header, deep-green story panel on the left with the house illustration, form on
   the warm canvas on the right. This replaces the full-page photo layout from
   `prompts/ui-auth-full-photo-clear-header.md`.
2. Deploy the app to Vercel (production, `fra1`) from the GitHub repo, backed by the Neon
   `production` branch and a new Upstash Redis, so the public pages and the sign-in page work live.

## References read

- `AGENTS.md` (design rules, compact system, security, checks)
- Design `04 — Sign In - Desktop.png` (1440px wide)
- `prompts/ui-auth-full-photo-clear-header.md`, `prompts/ui-clear-header-over-hero.md`,
  `prompts/infra-frankfurt.md` (Neon Frankfurt project, `vercel.json` fra1, Vercel deferred)
- `.env.example`, `src/lib/env.ts`, `src/lib/auth.ts`, `src/lib/rate-limit.ts`,
  `src/lib/email/send.ts`, `src/lib/storage/index.ts`, `drizzle.config.ts`, `scripts/seed-plans.ts`

## Existing code and account state inspected

- `src/components/auth/AuthShell.tsx`: full-page photo (`auth-living-room.jpg`), clear header,
  form in a white card. Commit `8652bd1` had a split layout close to the design (reused here).
- `src/components/layout/HeaderOverlayFlag.tsx`: `CLEAR_HEADER_PATHS` includes `/` and the five
  auth paths.
- `src/components/auth/SignInForm.tsx`: email, password, "Forgot password?", Sign in,
  "New here? Create an account". Unchanged.
- Tokens: `emerald-700` #087443 (Deep green), `emerald-600` #14833B (Forest), `mint-100` #DCEDE2,
  `canvas` #F7F8F5.
- Vercel: team `team_HsJuBUfjPo5OFEFeeBks9Gi5`, GitHub namespace `DenisMungai` connected, no
  project for this repo. `vercel.json` already pins `fra1`. Vercel CLI is not installed: use the
  Vercel MCP tools.
- Neon project `falling-sky-58396938` (Frankfurt): `production` branch `br-mute-star-b92vpkso`
  has 2 of 5 migrations applied (0000, 0001), no users.
- Upstash: no Redis databases.
- Production behaviour without services: rate limiting **throws** without Upstash (so sign-in
  would fail); email throws without Resend; photo uploads refused without R2; payments refused
  without Daraja credentials; job routes 503 without QStash keys.

## Decisions (user choices 2026-11-02 marked ✔)

1. ✔ **Production DB = Neon `production` branch.** Apply migrations 0002–0004 and seed the
   SANDBOX plans (`PLANS_SEED_CONFIRM=yes npm run plans:seed`) there. Seeded prices are the KES 1–3
   sandbox placeholders; real prices come later as version 2 (plans are immutable).
2. ✔ **Create a free Upstash Redis** `verifiedpropertieske-prod` in `eu-central-1`; its REST URL
   and token go to Vercel only (not `.env`).
3. ✔ **No email for now.** `RESEND_API_KEY` / `EMAIL_FROM` are left unset. Sign-in works for
   verified accounts; new sign-ups can't receive the verification email until Resend is added.
   I'll list what to set.
4. ✔ **Design's house illustration** in the panel; delete `src/assets/images/auth-living-room.jpg`
   (kept in git history).
5. **Header on auth pages is solid** (as in the design): `CLEAR_HEADER_PATHS` keeps only `/`.
6. **Build intended design, not mock defects:** panel body text and check points are white
   (the mock shows dark text on green); the Sign in button keeps white text; the overlapping
   body text in the mock is laid out properly. "Forgot password?" stays (not in the mock, needed).
7. **Vercel project** `verified-properties-ke`, linked to `DenisMungai/Verified-Properties-KE`,
   production branch `main`, framework Next.js, created with `deploy: false`. Env vars are set
   first, then the production deployment is triggered by pushing to `main` (or by
   `create_deployment` if the push doesn't trigger one).
8. **Production env vars** (target `production` only, so previews never touch the prod DB):
   | Key | Value | Type |
   |---|---|---|
   | `NEXT_PUBLIC_APP_URL` | `https://<assigned production domain>` (expected `verified-properties-ke.vercel.app`) | plain |
   | `DATABASE_URL` | Neon `production` branch, **pooled** | sensitive |
   | `BETTER_AUTH_SECRET` | fresh 48-byte random base64 (not the dev one) | sensitive |
   | `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | new Redis | sensitive |
   Not set (documented as follow-ups): Resend, R2, Daraja, Paystack, QStash, Africa's Talking.
9. **Commit and push** the UI change to `main` (needed for the Git deployment).

## Files likely to change

- `src/components/auth/AuthShell.tsx`
- `src/components/layout/HeaderOverlayFlag.tsx`
- `src/assets/images/auth-living-room.jpg` (deleted)
- No app code changes for deployment; `vercel.json` stays as is.

## Implementation requirements — sign-in UI

Layout (`AuthShell`, shared by sign-in, sign-up, forgot/reset password, check email; props and H1
unchanged):

- Root: `grid min-h-[calc(100dvh-67px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]`
  (panel ≈ 47.6% wide; design 680/1440 = 47.2%).
- **Story panel** `<aside>`: `hidden lg:flex flex-col gap-8 bg-emerald-700 px-10 py-14 xl:px-16
  text-white`; inner column `max-w-[34rem]` with:
  1. Brand line `BRAND.name`, `text-title font-bold text-white`.
  2. Headline "Your next chapter starts with a place.", `text-display-sm text-white max-w-sm`
     (wraps to two lines like the mock) plus body "Save homes you love, manage enquiries and
     connect with reviewed property professionals." `text-body text-white/90 max-w-md`, gap-4.
  3. `HouseIllustration` (`aria-hidden`): outer `rounded-lg bg-emerald-600 aspect-[550/290]
     w-full flex items-center justify-center`; inner house `relative h-[65%] w-[60%] rounded-lg
     bg-mint-100`; door `absolute bottom-0 left-1/2 -translate-x-1/2 h-[45%] w-[16%] rounded-t-md
     bg-emerald-700`. No windows (the mock has none). Tokens only, no hex.
  4. Points: one wrapping row, `text-body text-white/90`: Check icon (`size-4`, white,
     `aria-hidden`) then "Clear listings · Reviewed listers · Better decisions" as a `<ul>` whose
     `·` separators are `aria-hidden`.
- **Form side**: `flex justify-center bg-canvas px-4 py-10 md:px-6 lg:px-12 lg:pt-28`, content
  top-aligned like the mock (not vertically centred); inner `w-full max-w-[32rem] flex flex-col
  gap-6` with H1 `text-display-sm` + subtitle `text-body text-slate-600` (gap-2), then children.
  No card, border or shadow around the form.
- Below `lg`: panel hidden, form alone on canvas (unchanged behaviour).
- Remove the `next/image` import and photo; update the doc comment.

Header (`HeaderOverlayFlag`): `CLEAR_HEADER_PATHS = new Set(["/"])`; doc comment says only the
home hero runs behind the header.

## Implementation requirements — deployment (in this order)

1. UI change → checks pass → commit (`UI: sign-in matches design 04 split layout`) → do **not**
   push yet.
2. Upstash: `redis_create_database` (`free`, `eu-central-1`, `include_credentials: true`).
3. Neon production: `get_connection_string` for `br-mute-star-b92vpkso` (direct and pooled).
   Run `npm run db:migrate` and `npm run plans:seed` with `DATABASE_URL_UNPOOLED`/`DATABASE_URL`
   set **only for that command's process** (not written to `.env`/`.env.local`). Verify with SQL:
   5 rows in `drizzle.__drizzle_migrations`, 4 plans.
4. Vercel: `create_git_project` (`deploy: false`) → read the project's production domain →
   `create_project_env` for the variables in decision 8 (target `production`).
5. `git push origin main` → follow the production deployment until `READY` (on failure read build
   logs, fix, repeat). If no deployment is triggered, `create_deployment` with `gitSource` main,
   `target: production`.
6. Smoke test on the live URL: `/`, `/properties`, `/sign-in` (layout matches), a sign-in attempt
   with a wrong password shows the normal error (proves DB + Redis + auth work), runtime errors
   empty.

## Security requirements

- No secret (connection strings, auth secret, Redis token) is printed in chat, committed, written
  to repo files or logged; Vercel values use type `sensitive`.
- Production gets its own `BETTER_AUTH_SECRET`; `.env`/`.env.local` are not modified.
- Production env vars target `production` only; preview deployments get no DB access.
- Nothing is deleted in Neon, Upstash or Vercel. Writes to the Neon `production` branch are limited
  to the committed migrations and the idempotent plans seed.
- Payments, uploads, jobs and email stay refused in production until their credentials exist
  (existing behaviour; no bypasses added).

## Acceptance criteria

- At 1440px, `/sign-in` shows: solid white header (green logo, Explore, Log in, Get started); left
  ≈47% deep-green panel with brand line, two-line headline, body, the Forest-green block with the
  mint house and deep-green door, and the check-point row, all in readable white; right side warm
  canvas with "Welcome back", subtitle, email, password, Forgot password, full-width Sign in, "New
  here? Create an account". No overlapping text.
- At 375/768px: form alone on canvas, no horizontal scroll. Sign-up, forgot/reset password and
  check email share the layout. Home header still clears over the hero.
- Vercel production deployment is `READY` in `fra1` at the production URL; `/`, `/properties` and
  `/sign-in` load; a bad sign-in returns the normal "incorrect email or password" style error, not
  a server error.

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Manual test steps (after implementation)

1. Locally: `npm run dev`, open `http://localhost:3000/sign-in` at desktop width and compare with
   the design PNG; shrink to phone width; open `/sign-up`; check `/` still has the clear header.
2. Live: open `https://<production domain>/sign-in` and `/`.
3. Try signing in with a made-up account: you get the normal error message.
4. To enable sign-up emails later: in Vercel → Project → Settings → Environment Variables add
   `RESEND_API_KEY` and `EMAIL_FROM` (Production), then redeploy.
