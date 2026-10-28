# VerifiedPropertiesKE

Kenyan property marketplace. Listers pay a monthly M-Pesa subscription to publish listings, and
a separate monthly fee for a "Profile verified" badge that ranks them first. Buyers and tenants
search, save and contact listers for free.

Stack: Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS v3 · Neon Postgres ·
Drizzle · Zod 4 · Better Auth · M-Pesa Daraja · Cloudflare R2 · Upstash QStash and Redis · Resend.

- Scope and rules: [docs/implementation-plan-v2.md](docs/implementation-plan-v2.md)
- How work is done here (agents and humans): [AGENTS.md](AGENTS.md)
- Slice prompts: [prompts/](prompts/)
- UI design: [design/VerifiedPropertiesKE-Full-UI-Design-System/](design/VerifiedPropertiesKE-Full-UI-Design-System/)

**Status:** S0 (foundation) and S1 (authentication, accounts, design alignment) are built.
Next: S2 (billing schema and entitlements).

## Setup

```bash
npm install
cp .env.example .env.local   # or .env; both are loaded and .env.local wins
npm run dev                  # http://localhost:3000, component guide at /styleguide
```

Tests and the build run without any env file. Running the app needs `DATABASE_URL` and
`BETTER_AUTH_SECRET` (generate with `openssl rand -base64 48`).

### Email and rate limits in development

Without `RESEND_API_KEY` / `EMAIL_FROM`, verification and reset emails are printed to the
`npm run dev` terminal (recipient masked, link shown). Without `UPSTASH_REDIS_REST_*`, rate limits
run in memory. In production (`next start` or Vercel) both are required: the app refuses to send
email or accept sign-ins without them.

### First admin

Sign up and confirm the email, then (operator only):

```bash
ADMIN_CREATE_CONFIRM=yes npm run admin:create -- you@example.com                       # platform_admin
ADMIN_CREATE_CONFIRM=yes npm run admin:create -- you@example.com --role billing_admin
# PowerShell: $env:ADMIN_CREATE_CONFIRM="yes"; npm run admin:create -- you@example.com
```

### Database (Neon)

1. Create a Neon project, then two branches: `dev` and `test`.
2. In `.env.local` (or `.env`), from the `dev` branch:
   - `DATABASE_URL`: the **pooled** connection string (host contains `-pooler`), used by the app.
   - `DATABASE_URL_UNPOOLED`: the **direct** connection string (no `-pooler`), used by migrations.
3. Apply migrations: `npm run db:migrate`.
4. For integration tests: set `TEST_DATABASE_URL` to the `test` branch, migrate that branch (run
   `npm run db:migrate` with `DATABASE_URL_UNPOOLED` pointing at it), then
   `npm run test:integration`.
5. **Region:** put the Neon project in the region closest to where the app runs (Vercel `fra1` with
   Neon `aws-eu-central-1` is the nearest pair to Kenya). Every query is a network round trip, so a
   distant region makes each page several seconds slower.

`drizzle/0000_extensions.sql` enables `pg_trgm`. `0001_core_schema.sql` creates the core tables
and the append-only triggers on the moderation and verification audit logs. After changing
`src/db/schema.ts`, run `npm run db:generate` and commit the new migration. CI fails if schema and
migrations disagree.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (Turbopack). One `next dev` per project folder |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint CLI (`next lint` no longer exists) |
| `npm test` | Vitest unit tests; `*.integration.test.ts` skip unless `TEST_DATABASE_URL` is exported |
| `npm run test:integration` | Integration tests against the Neon test branch (env from `.env` / `.env.local`) |
| `npm run admin:create` | Operator-only role grant (see First admin) |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit |

## Structure

```text
src/
  app/                  (auth) sign-in, sign-up, check-email, forgot/reset-password;
                        account (overview, onboarding, profile, saved, settings); admin;
                        api/auth (GET-only Better Auth callbacks); styleguide
  proxy.ts              optimistic session-cookie redirect for /account and /admin
  components/ui/        Button (primary/secondary/quiet/ghost/danger), IconButton, Field, Input,
                        Select, Textarea, Badge (VerifiedBadge), Chip, SegmentedControl, ...
  components/layout/    SiteHeader, AccountMenu, MobileMenu, SiteFooter, Logo, PageContainer
  components/auth|account|forms/   form components (useActionState + Server Actions)
  db/                   schema.ts, index.ts (Neon HTTP), tx.ts (WebSocket transactions), queries/
  lib/                  auth-config (Better Auth factory), auth, session, roles, rate-limit,
                        email/, validation/, safe-redirect, env, format, kenya, greeting
scripts/                create-admin.ts (operator only)
drizzle/                SQL migrations
docs/                   implementation plan v2.0
prompts/                one approved prompt per slice
design/                 UI design system and screens
```

## Decisions worth knowing

- **Design** comes from `design/VerifiedPropertiesKE-Full-UI-Design-System/`: Forest `#14833B`,
  Charcoal `#17231D`, Warm canvas `#F7F8F5`, and a **90% CSS root** (14.4px body). Touch targets
  stay 44px (px-based). Form-control borders use a darker grey (`#8C968F`) for 3:1 contrast, and
  warning text uses `#8A5206`.
- **Auth** is Better Auth on our own tables. Sign-in, sign-up, resets and account changes run
  through rate-limited Server Actions; `/api/auth` serves GET callbacks only. Email verification is
  required before a session exists. Roles come only from server allowlists (`buyer_tenant` at
  sign-up, `agent`/`owner` from the listing profile) or the operator script.
- **Money** is whole shillings: `properties.price_kes` is `bigint`, capped at
  `Number.MAX_SAFE_INTEGER`. `formatKes` rejects fractions.
- **The verified badge is never stored.** No profile or listing column holds it. It is derived
  (S2) from an approved, unexpired review plus active verification and listing subscriptions.
  `VerifiedBadge` always reads "Profile verified".
- **Featured is computed**, so there is no `featured` column for a client to set.
- **Listing status `paused`** means the plan lapsed past grace or the listing is over the plan
  limit. Only `published` is public.
- **Location privacy:** exact coordinates live in `exact_*` columns that public queries must
  never select. PostGIS arrives in Phase 3.
- **Audit logs are append-only** at the database level: a trigger rejects UPDATE and DELETE.
- **Neon HTTP driver** for normal queries; `withTransaction()` (WebSocket pool) for multi-step
  atomic writes.
- **Cache Components is on:** request-time data (session, search params) renders inside
  `<Suspense>`.
