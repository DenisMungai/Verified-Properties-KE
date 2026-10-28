# VerifiedPropertiesKE

Kenyan property marketplace. Listers pay a monthly M-Pesa subscription to publish listings, and
a separate monthly fee for a "Profile verified" badge that ranks them first. Buyers and tenants
search, save and contact listers for free.

Stack: Next.js 16 (App Router, Cache Components) · TypeScript · Tailwind CSS v3 · Neon Postgres ·
Drizzle · Zod 4 · Better Auth · M-Pesa Daraja · Cloudflare R2 · Upstash QStash and Redis · Resend.

- Scope and rules: [docs/implementation-plan-v2.md](docs/implementation-plan-v2.md)
- How work is done here (agents and humans): [AGENTS.md](AGENTS.md)
- Slice prompts: [prompts/](prompts/)

**Status:** S0 (foundation) is built: design tokens, UI kit, `/styleguide`, formatting
utilities and the v2.0 core schema. Next: S1 (authentication).

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev            # http://localhost:3000, component guide at /styleguide
```

The app, tests and build run without any `.env.local`. The database is needed from S1 onwards.

### Database (Neon)

1. Create a Neon project, then two branches: `dev` and `test`.
2. In `.env.local`, from the `dev` branch:
   - `DATABASE_URL`: the **pooled** connection string (host contains `-pooler`), used by the app.
   - `DATABASE_URL_UNPOOLED`: the **direct** connection string, used by migrations.
3. Apply migrations: `npm run db:migrate`.
4. Optional, for integration tests: set `TEST_DATABASE_URL` to the `test` branch's direct URL,
   migrate that branch (run `npm run db:migrate` with `DATABASE_URL_UNPOOLED` pointing at it),
   then `npm test`.

`drizzle/0000_extensions.sql` enables `pg_trgm`. `0001_core_schema.sql` creates the core tables
and the append-only triggers on the moderation and verification audit logs. After changing
`src/db/schema.ts`, run `npm run db:generate` and commit the new migration. CI fails if schema and
migrations disagree.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (Turbopack) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint CLI (`next lint` no longer exists) |
| `npm test` | Vitest. `*.integration.test.ts` files skip unless `TEST_DATABASE_URL` is set |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit |

## Structure

```text
src/
  app/                  routes: / (placeholder), /styleguide, not-found
  components/ui/        Button, IconButton, Input, Select, Textarea, Field, Badge (VerifiedBadge),
                        Chip, SegmentedControl, Skeleton, EmptyState, Spinner
  components/layout/    PageContainer
  db/                   schema.ts, index.ts (Neon HTTP), tx.ts (WebSocket transactions)
  lib/                  brand, cn, env (lazy Zod), format (KES, Nairobi time, areas),
                        kenya (counties, phone normalisation for E.164 and Daraja)
drizzle/                SQL migrations
docs/                   implementation plan v2.0
prompts/                one approved prompt per slice
```

## Decisions worth knowing

- **Design tokens** come from *PropertyHub Design System v1.0* (markdown), not the design boards.
  Primary green `#14833B` already meets AA with white text. `slate-500` is for placeholders and
  icons only. The warning badge uses a darker text shade for 12px contrast.
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
  atomic writes such as payment confirmation.
- **Cache Components is on:** request-time data must render inside `<Suspense>`.
