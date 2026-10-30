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

1. Create a Neon project in `aws-eu-central-1` (Frankfurt), then two branches from `production`:
   `dev` and `test`. The project in use is "Verified Properties KE" (`falling-sky-58396938`).
2. In `.env.local` (or `.env`), from the `dev` branch:
   - `DATABASE_URL`: the **pooled** connection string (host contains `-pooler`), used by the app.
   - `DATABASE_URL_UNPOOLED`: the **direct** connection string (no `-pooler`), used by migrations.
3. Apply migrations: `npm run db:migrate`.
4. For integration tests: set `TEST_DATABASE_URL` to the `test` branch, migrate that branch (run
   `npm run db:migrate` with `DATABASE_URL_UNPOOLED` pointing at it), then
   `npm run test:integration`.
5. **Region:** Neon `aws-eu-central-1` pairs with Vercel `fra1`, which `vercel.json` pins for the
   app's functions. Every query is a network round trip, so keep the two together: from Kenya, a
   Singapore database took about 1.4s per query against about 0.2s for Frankfurt.
6. **Production:** when deploying, set Vercel's `DATABASE_URL` to the `production` branch's
   **pooled** string and run `npm run db:migrate` against its direct string.

`drizzle/0000_extensions.sql` enables `pg_trgm`. `0001_core_schema.sql` creates the core tables
and the append-only triggers on the moderation and verification audit logs. `0002_billing.sql`
adds the billing tables, then hand-written SQL that drizzle-kit does not track: append-only and
immutable-terms triggers, the `verified_listers_now` view and `lister_verified_now()`. After
changing `src/db/schema.ts`, run `npm run db:generate` and commit the new migration. CI fails if
schema and migrations disagree.

### Sandbox plans

After migrating, seed the placeholder plans (Starter 3 / Pro 20 / Agency 100 listings, plus
Verification, at KES 1–3 for the Daraja sandbox). Idempotent; operator only:

```bash
PLANS_SEED_CONFIRM=yes npm run plans:seed
# PowerShell: $env:PLANS_SEED_CONFIRM="yes"; npm run plans:seed
```

Real prices are added later as a new plan version, never by editing these rows.

### Photo storage (R2)

Without R2 settings, development stores photos under `.data/storage/` (git-ignored) and serves
them through dev-only routes under `/api/dev-storage/`, which return 404 in production or once R2
is set. Production refuses uploads until R2 is configured. Before deploying, once:

1. Create two R2 buckets: a **public** one for listing photos (connect a custom domain or enable
   r2.dev) and a **private** one with no public access.
2. Create an R2 API token with Object Read & Write on both, and set the six `R2_*` variables
   (see `.env.example`) in Vercel and `.env.local`.
3. Add a CORS rule on the **private** bucket so browsers can upload directly:

   ```json
   [{ "AllowedOrigins": ["http://localhost:3000", "https://<your-domain>"],
      "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type"], "MaxAgeSeconds": 3600 }]
   ```

4. Add a lifecycle rule on the private bucket: delete objects with prefix `uploads/` after 1 day.
   The orphan sweep (`src/lib/storage/cleanup.ts`, scheduled in S9) does the same, plus unused
   public variants.

### M-Pesa (S5)

Without Daraja credentials, development uses a **simulator**: set only `MPESA_CALLBACK_TOKEN`
(`openssl rand -hex 24`). STK pushes send nothing to a phone, and `npm run mpesa:simulate` posts a
realistic callback to the running dev server. Production refuses payments until all four Daraja
credentials are set.

```bash
MPESA_PAY_CONFIRM=yes npm run mpesa:pay -- --email you@example.com --plan starter --phone 0712345678
# PowerShell: $env:MPESA_PAY_CONFIRM="yes"; npm run mpesa:pay -- --email ... --plan starter --phone 07...
npm run mpesa:simulate -- --checkout ws_CO_SIM_... [--result success|cancelled|insufficient] [--amount 5] [--receipt CODE]
npm run mpesa:status -- VPK0000012
```

Daraja sandbox: create an app with M-Pesa Express on developer.safaricom.co.ke, set
`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE=174379` and the sandbox
`MPESA_PASSKEY`, expose the dev server (`cloudflared tunnel --url http://localhost:3000`) and set
`MPESA_CALLBACK_BASE_URL` to the https URL. `npm run mpesa:register-c2b [-- --shortcode 600xxx]`
registers the Paybill callbacks.

Before go-live: apply for Daraja production early, and confirm Safaricom's callback IP ranges
(`MPESA_CALLBACK_ALLOWED_IPS`; production defaults to the community-documented
`196.201.212-214.0/24`).

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js (Turbopack). One `next dev` per project folder |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint CLI (`next lint` no longer exists) |
| `npm test` | Vitest unit tests; `*.integration.test.ts` skip unless `TEST_DATABASE_URL` is exported |
| `npm run test:integration` | Integration tests against the Neon test branch (env from `.env` / `.env.local`) |
| `npm run admin:create` | Operator-only role grant (see First admin) |
| `npm run plans:seed` | Operator-only sandbox plan seed (see Sandbox plans) |
| `npm run mpesa:pay` / `mpesa:simulate` / `mpesa:status` | Dev/sandbox payment tools (see M-Pesa) |
| `npm run mpesa:register-c2b` | Operator: register the Paybill callback URLs with Daraja |
| `npm run db:generate` / `db:migrate` / `db:studio` | Drizzle Kit |

## Structure

```text
src/
  app/                  (auth) sign-in, sign-up, check-email, forgot/reset-password;
                        account (overview, onboarding, profile, saved, settings,
                        listings: new → [id]/basics → details → photos → preview); admin;
                        api/auth (GET-only Better Auth callbacks); api/dev-storage (dev only);
                        api/payments (Daraja STK and C2B callbacks); account/billing actions;
                        styleguide
  proxy.ts              optimistic session-cookie redirect for /account and /admin
  components/ui/        Button (primary/secondary/quiet/ghost/danger), IconButton, Field, Input,
                        Select, Textarea, Badge (VerifiedBadge), Chip, SegmentedControl, ...
  components/layout/    SiteHeader, AccountMenu, MobileMenu, SiteFooter, Logo, PageContainer
  components/auth|account|forms/   form components (useActionState + Server Actions)
  components/listings/  stepper, Basics/Details forms, PhotoManager, ListingImage, plan usage panel,
                        summary, status actions
  db/                   schema.ts, index.ts (Neon HTTP), tx.ts (WebSocket transactions), queries/
  lib/                  auth-config (Better Auth factory), auth, session, roles, rate-limit,
                        email/, validation/, safe-redirect, env, format, kenya, greeting
  lib/billing/          constants, periods (30-day period, 3-day grace), entitlements (canPublish)
  lib/listings/         workflow (lister transitions, material edits, status labels), slug
  lib/storage/          ObjectStore (R2, dev disk), keys, limits, image processing (sharp),
                        ingest, orphan cleanup
  lib/mpesa/            Daraja client (HTTP, dev simulator), callback guard, payloads, start,
                        settle (callback + STK Query), confirm (one transaction), C2B
scripts/                create-admin.ts, seed-plans.ts (operator only), mpesa-*.ts (dev/sandbox)
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
- **The verified badge is never stored.** No profile or listing column holds it. The
  `verified_listers_now` view (and `lister_verified_now()`, read by `isListerVerified()`) derives
  it from an approved, unexpired review plus a verification subscription and a listing plan that
  are each paid up or within 3 days of grace. Search ranking joins the view; nothing in
  TypeScript re-implements the rule. `VerifiedBadge` always reads "Profile verified".
- **Billing data model** (plan §4, §6): versioned `plans` whose price and limit are immutable by
  trigger; one live `subscription` per owner and kind; `invoices` numbered `VPK0000001` (fits
  Daraja's 12-character account reference) with immutable amounts; `payments` with unique
  CheckoutRequestID and M-Pesa receipt; append-only `payment_events` and `billing_audit_log`.
- **Listing pool:** a lister in an agency (`lister_profiles.agency_id`) uses the agency's plan and
  shares its limit; everyone else uses their own plan. Published and pending-review listings use
  a slot. Publishing or un-pausing needs a paid-up plan; during grace, live listings stay up but
  nothing new goes live (`getPublishEntitlement()` in `src/db/queries/billing.ts`).
- **Listing management** (plan §9): drafts save step by step and may be incomplete; Submit
  checks the stored listing and at least one photo (`parseSubmission`), then the owner's plan
  under a per-pool advisory lock. Verified owners publish at once; everyone else goes to
  `pending_review`. Only the owner or an agency admin of the listing's agency can manage it
  (`manageableBy`). Status, owner, agency and slug are never read from forms. A material edit
  (title, description, category, type, location, or a new photo) by an unverified owner sends a
  published listing back to review and turns a paused one into a draft.
- **Photos** (plan §9): the browser uploads straight to the **private** bucket through a 5-minute
  presigned URL; file bytes never pass through a Server Action. The server then checks the real
  type from the bytes (JPEG, PNG, WebP), size (8 MB) and dimensions (800 × 600 minimum), and
  re-encodes with sharp into 480/960/1600 px WebP in the **public** bucket, which drops all EXIF
  and GPS data. Keys are generated (`listings/<listing>/<image>-<width>.webp`), never taken from
  file names. Up to 20 photos per listing, counted under a row lock; every photo needs a
  description (alt text). `ListingImage` picks the variant per width with a `next/image` loader,
  so there is no runtime image optimisation.
- **Payments** (plan §4): the client sends only a plan code and phone; price, plan and owner come
  from the database. A payment is confirmed only when the STK callback (which alone carries the
  receipt and amount) and STK Query agree; `confirmPayment` then marks it paid, extends the
  subscription 30 days (an early renewal stacks onto the current end) and restores billing-paused
  listings newest first, in one transaction under row locks. A replayed callback finds the payment
  already confirmed; amount mismatches and disagreements are flagged and activate nothing. Every
  callback, query and status change is appended to `payment_events`. Callback routes
  (`/api/payments/...`, no "mpesa" in the path) need a secret path token (else 404) and, where
  enforced, an allowlisted IP (else 403). Paybill (C2B) payments match the invoice number and
  amount exactly; STK Query can't check them, so S9's reconciliation is the second check.
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
