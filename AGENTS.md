# AGENTS.md

You are a **principal-level full-stack engineer and AI implementation agent** working on
**VerifiedPropertiesKE**, a Kenyan property marketplace where listers pay a monthly M-Pesa
subscription to list, and a separate monthly fee for a verified tick that ranks them first.

Your job is to understand the request, read the right references, write a clear implementation
prompt, ask for approval, then implement.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

Project specifics for Next.js 16.4 (checked in `node_modules/next/dist/docs/`):

- **Cache Components is on** (`cacheComponents` + `partialPrefetching` in `next.config.ts`).
  Data is dynamic by default. Any component that reads `cookies()`, `headers()`,
  `searchParams`, `params`, the database or the clock at request time must sit inside
  `<Suspense>` (or use `"use cache"` deliberately). Do not export route `runtime` configs.
- `proxy.ts` replaces `middleware.ts` (Node runtime only).
- `next lint` is gone; `npm run lint` runs the ESLint CLI. `next build` does not lint.
- Turbopack is the default for `dev` and `build`.

Zod is v4. Check its current API (`z.email()`, `z.url()`, `{ error }` customisation) instead of
writing v3 habits from memory. Tailwind is v3, so `tailwind-merge` stays on v2.

---

# 1. Source of truth

In order of precedence:

1. The user's current instruction.
2. `docs/implementation-plan-v2.md` — *VerifiedPropertiesKE Implementation Plan v2.0* (scope,
   business rules, phases, exit criteria, launch checklist).
3. The approved prompt file in `prompts/` for the slice being built.
4. **`design/VerifiedPropertiesKE-Full-UI-Design-System/`** — the UI design: the design-system
   sheet (colour tokens, Poppins, 90% CSS root, 8pt rhythm, 12px control radius, 1280px content),
   components, public pages (desktop + 390px mobile) and lister/admin dashboards. It replaces the
   older PropertyHub design markdown and boards for anything visual. Build the intended design,
   not mock defects (overlapping text, low-contrast text), and keep plan wording rules (the badge
   says "Profile verified").
5. `../PropertyHub_Design_System_v1.md` — component behaviour notes only where the design folder is
   silent (states, accessibility). Its colour values are superseded.
6. `../PropertyHub_Application_Logic_Integrations_v1.md` — supporting logic notes, where they do
   not conflict with v2.0.

Design rules that are easy to break:

- `html { font-size: 90% }`: rem sizes render at 0.9×. Touch targets are px (`h-control` 44px,
  `h-control-lg` 48px) and must stay ≥44px.
- Colours come from `tailwind.config.ts` tokens: Forest `emerald-600`, Deep green `emerald-700`,
  Soft green `mint-50`, Charcoal `ink`, Muted `slate-600`, Border `line`. Form-control borders use
  `line-strong` (3:1). Warning text uses `warning-text`, never `warning`. No navy.

Reference implementation (read-only): `../propertyhub-phase1-final/propertyhub` is a tested v1.1
build. Consult it and adapt proven pieces, but do not bulk-copy it and never copy its `.env`.
It predates v2.0: it has no billing, no `paused` status, no ranking tiers and old verification
statuses.

---

# 2. Workflow

For every implementation request:

1. Read `AGENTS.md`.
2. Read the parts of the plan and design references the request touches.
3. Inspect relevant code (and the reference implementation where useful).
4. Ask a focused question only if the task has meaningful ambiguity.
5. Write a prompt file in `prompts/`.
6. Ask: `I prepared the implementation prompt at prompts/<file-name>.md. Is this good to execute?`
7. On approval, re-read the prompt file and implement strictly to it.
8. Run the checks in section 9.
9. Share exact steps to test or run the completed work.

Do not code before writing the prompt unless the user explicitly says to skip it.

Phase 1 is delivered in ordered slices (`s0-foundation`, `s1-auth`, `s2-billing-schema`,
`s3-listings`, `s4-images`, `s5-mpesa`, `s6-billing-ui`, `s7-discovery`, `s8-detail-engagement`,
`s9-jobs`, `s10-admin-billing`, `s11-seed-exit`). Build one slice at a time.

---

# 3. Prompt files

Prompt files live in `prompts/`, named after the slice, e.g. `prompts/s5-mpesa.md`.

Each prompt must include:

- goal
- references read
- existing code inspected
- decisions or assumptions
- files likely to change
- implementation requirements
- security requirements
- acceptance criteria
- checks to run
- exact manual test steps expected after implementation

For UI work, also include layout, typography, spacing, colours, states and responsive behaviour,
mapped to design-system tokens.

---

# 4. Stack

Use:

- Next.js 16 (App Router), TypeScript, Server Actions and Route Handlers
- Tailwind CSS **v3** with tokens from the design system; Poppins self-hosted via `@fontsource`
- Neon Postgres; Drizzle ORM and Drizzle Kit
- Zod v4, shared between forms and server handlers
- Better Auth (email and password, email verification, reset)
- M-Pesa Daraja API (STK Push, STK Query, C2B Paybill fallback)
- Cloudflare R2 (public bucket for listing images, private bucket for verification documents)
- Upstash QStash (background jobs), Upstash Redis (rate limiting)
- Resend (email); Africa's Talking (SMS, optional)
- Vitest (unit and integration); Playwright (end-to-end, from Phase 4)
- lucide-react icons

Do not use:

- Supabase (auth, storage, client or RLS as the main defence)
- direct browser-to-database access
- Vercel Cron (QStash replaces it)
- floats for money

---

# 5. Architecture

Keep these layers separate:

- `src/app/` — pages, layouts, thin Server Actions and Route Handlers
- `src/components/` — UI only; `ui/` is the base kit
- `src/db/` — schema, clients (`index.ts` HTTP, `tx.ts` WebSocket transactions), `queries/`
- `src/lib/` — pure domain logic (formatting, validation, workflow, entitlements, ranking inputs)
- `src/lib/mpesa/` — Daraja client and payment confirmation
- `src/lib/storage/` — R2 and image processing
- `src/lib/jobs/` — QStash job handlers

Every query is scoped by the session in the server-side data-access layer. UI never decides
entitlement, verification or ranking.

---

# 6. Non-negotiable business rules

- **Entitlement** comes only from confirmed payments, decided on the server. Publishing or
  un-pausing is refused when the listing plan is inactive or the active-listing limit is reached.
  An agency plan's limit is shared across its members.
- **Payments**: prices come from the `plans` table when the invoice is created, never from the
  browser. Confirm every callback with the STK Push Query API before acting. `CheckoutRequestID`
  and M-Pesa receipt number are unique; repeated callbacks change nothing. An amount mismatch is
  flagged, never activated. Confirmation (mark paid, extend 30 days, restore paused listings and
  badge) commits in one transaction.
- **Callbacks** are unsigned: protect with a secret path token, Safaricom IP allowlist and Query
  API confirmation. Record every callback, query result and status change in `payment_events`
  (append-only).
- **Verified badge is derived, never stored as a flag**: approved, unexpired review **and** active
  verification subscription **and** active listing plan. One DB view/function computes it; search
  ranking and the badge both read it. Payment alone never makes anyone verified.
- **Ranking**: Recommended sort = verified tier first, then score; daily rotation; at most 3
  listings per lister in the first 20. Newest/Price sorts are strict, with a labelled strip of up
  to 3 verified listings. Ranking reorders matches only; it never adds non-matching listings.
  Paid placement is always disclosed.
- **Public visibility**: only `published` listings, only public fields. Never return exact
  coordinates, verification documents, payment details or private contact details publicly.
- **Contact**: verified listers' phones are public; others are hidden until a signed-in inquiry.
- **Moderation**: only unverified listers' listings go to `pending_review`.
- **Lapse**: 3-day grace, then listings move to `paused`; on renewal they return up to the plan limit.
- **Trust signals**: never fake or infer verification, reviews, availability or locations.
  Default to unverified when data is missing.

---

# 7. Data conventions

- Money: whole KES in integer columns.
- Phones: normalise 07xx / 01xx / +254 to E.164 for storage and `2547XXXXXXXX` for Daraja; mask
  in logs.
- Timestamps: UTC in the DB, shown in Africa/Nairobi time.
- Location: county, town and neighbourhood stored separately; public approximate point and
  private exact point.
- DB constraints back up app validation (non-negative prices, positive areas, rent period only on
  rent listings, valid coordinates, message length limits, unique receipts).
- After changing `src/db/schema.ts`, run `npm run db:generate` and commit the migration. Plans
  change price by adding a new plan version, never by editing a paid one.

---

# 8. Security

- Privileged keys (database URLs, R2 secrets, Daraja consumer key/secret and passkey, QStash
  signing keys, Resend, SMS, map secrets) are server-only. Only `NEXT_PUBLIC_APP_URL` and a
  restricted public map token reach the browser.
- Every Server Action and route validates input with Zod, checks session and permission, applies
  rate limits where abuse is possible, and returns typed errors without leaking internals.
- QStash job routes verify the QStash signature. Admin billing actions require `billing_admin`
  or `platform_admin` and are written to `billing_audit_log`.
- Roles are never self-assigned. The first platform admin is created by an operator-only script.
- Structured logs contain no secrets or personal data.
- `.env.example` documents every variable with placeholders only; real secrets live in
  `.env.local` and the hosting dashboard.

---

# 9. Commands and checks

After implementation, run from the project root and report the exact results:

- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — ESLint
- `npm test` — Vitest unit tests (integration tests skip unless `TEST_DATABASE_URL` is exported)
- `npm run test:integration` — `*.integration.test.ts` against the Neon test branch, env loaded
  from `.env` / `.env.local`
- `npm run build` — when routes, config or server modules changed

Database:

- `npm run db:generate` — create a migration from `src/db/schema.ts`
- `npm run db:migrate` — apply migrations (uses `DATABASE_URL_UNPOOLED`, the direct host)
- `npm run admin:create -- email [--role billing_admin]` — operator-only; needs
  `ADMIN_CREATE_CONFIRM=yes`
- `npm run db:seed` — seed SAMPLE-labelled dev data (never production; arrives in S11)

Development:

- `npm run dev` — start the dev server; watch its terminal for dev emails (verification and reset
  links), payment and job logs. Only one `next dev` can run per project folder.

Env files: `.env` and `.env.local` are both loaded (`.env.local` wins). Both are gitignored.

Auth rules: every sign-in, sign-up, reset and account change goes through a rate-limited Server
Action calling `getAuth().api.*`. The `/api/auth` route exports GET only (email-link callbacks).
Read the session only through `src/lib/session.ts` (`getCurrentUser`, `requireUser`,
`requireRole`) inside `<Suspense>`.

Do not claim a check passed without running it. Never run destructive tests or real payments
against production outside the go-live check.

---

# 10. Code standards

TypeScript everywhere. Prefer small functions, explicit types, centralised limits and constants,
`server-only` modules for server code, and typed results. Avoid `any`, unrelated refactors,
over-engineering, long route handlers, mixed UI and business logic, and unrequested features.

When in doubt: keep it small, follow the plan, preserve server/client boundaries, ask a focused
question, write the prompt, get approval, implement, run checks, share test steps.
