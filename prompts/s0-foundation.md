# S0 — Foundation (Phase 0 rebuild)

## Goal

Create the VerifiedPropertiesKE project skeleton in this folder. It needs the design-system tokens,
the base UI kit, Kenyan formatting utilities, the Neon/Drizzle setup with the **full v2.0 core
schema** (no billing tables yet; those come in S2), and tooling (ESLint, Vitest, CI). Every later
slice builds on this. The result must type-check, lint, test and build with no database configured.

## References read

- `AGENTS.md` (this repo)
- *VerifiedPropertiesKE Implementation Plan v2.0* (PDF): §2 stack, §3 Neon practices, §6 data
  model, §8 Phase 0 deliverables, §14 cross-cutting rules (localisation, accessibility, design
  fidelity: **markdown tokens are the source of truth**)
- `../PropertyHub_Design_System_v1.md`: §2 tokens, §3 layout, §4 components, §5 Tailwind mapping,
  §9 accessibility
- Reference implementation `../propertyhub-phase1-final/propertyhub`: `src/db/schema.ts`,
  `src/db/tx.ts`, `src/lib/env.ts`, `src/lib/format.ts`, `src/lib/kenya.ts`, `src/components/ui/*`,
  `tailwind.config.ts`, `.github/workflows/ci.yml`

## Existing code inspected

- This folder holds only `AGENTS.md` and `prompts/`. There is no git repo yet.
- Installed toolchain: Node 24.14.1, npm 11.21.0.
- Current versions: next 16.4.3, react 19.3.1, tailwindcss 3.4.19 (v3 line), drizzle-orm 0.45.4,
  drizzle-kit 0.31.11, @neondatabase/serverless 1.2.0, zod 4.6.7, vitest 5.0.5,
  eslint-config-next 16.4.3, @fontsource/poppins 5.3.0, lucide-react 1.63.0.

## Decisions and assumptions

1. **Tokens come from the design-system markdown, not the old board palette.** Primary
   `emerald-600 #14833B`, hover `emerald-700 #087443`, navy `#0B1F3A`, canvas `#F7F7F3`,
   ink `#171B22`, muted text `slate-600 #687280`.
   - These already pass WCAG AA: white on `#14833B` is about 4.8:1, and `#687280` on canvas is about 4.5:1.
   - So the old build's workarounds (`#0F8552`, `#5B6B80`) are **not** carried over. This corrects the
     approved plan, which assumed they were still needed.
   - `slate-500 #87919E` is for placeholders and decorative icons only, never essential text.
2. **Tailwind v3** as the plan specifies. Scaffold with `create-next-app` *without* Tailwind, then
   install `tailwindcss@3`, `postcss` and `autoprefixer`, because create-next-app now installs v4.
3. **Money is integers.** `properties.price_kes` is `bigint` whole shillings (mode `number`, with a
   `CHECK (price_kes <= 9007199254740991)`). This replaces the old `numeric(14,2)`.
4. **The badge is never stored.** `lister_profiles` has **no** `verification_status`, `verified_at`
   or `verification_expires_at` columns.
   - Review state lives on `verification_requests`: `status`, `decided_at`, `review_expires_at`.
   - The derived `lister_verified_now` function arrives in S2, together with subscriptions.
5. **`featured` is not a column.** Featured placement is computed (verified, quality bar, rotation)
   in Phase 2, so there is no client-settable flag to ignore.
6. Better Auth core tables (`users`, `sessions`, `accounts`, `verifications`) are defined in S0,
   because every foreign key points at `users(id)`. S1 wires up Better Auth against them.
7. Phase 2 tables named in plan §6 (`conversations`, `messages`, `verification_requests`,
   `verification_documents`, `verification_audit_log`) are created now, as the plan lists them in
   the initial migration. No code uses them until Phase 2.
8. The project and package name is `verifiedpropertieske`, and the display name is
   `VerifiedPropertiesKE` (in `src/lib/brand.ts`).
9. Create a markdown copy of the v2.0 PDF at `docs/implementation-plan-v2.md`, since AGENTS.md
   names it as the source of truth.
10. CI runs integration tests against a Postgres 16 service container. Local integration tests use
    a Neon `test` branch through `TEST_DATABASE_URL`. Tests skip cleanly when it is unset.

## Files likely to change (all new)

```text
.gitignore  .env.example  README.md  AGENTS.md (exists)
package.json  tsconfig.json  next.config.ts  postcss.config.mjs  tailwind.config.ts
eslint.config.mjs  vitest.config.mts  drizzle.config.ts
.github/workflows/ci.yml
docs/implementation-plan-v2.md
drizzle/0000_extensions.sql  drizzle/0001_core_schema.sql  drizzle/meta/*
src/app/layout.tsx  src/app/page.tsx (placeholder home)  src/app/globals.css  src/app/not-found.tsx
src/app/styleguide/page.tsx  src/app/styleguide/StyleguideDemo.tsx
src/components/ui/{Button,IconButton,Input,Select,Textarea,Field,Badge,Chip,SegmentedControl,Skeleton,EmptyState,index}.tsx
src/components/layout/PageContainer.tsx
src/db/schema.ts  src/db/index.ts  src/db/tx.ts
src/lib/{brand,cn,env,format,kenya}.ts  + *.test.ts
```

## Implementation requirements

### Project and tooling
- Run `git init` with a Node-oriented `.gitignore` that excludes `.env*` except `.env.example`, plus
  `.next`, `node_modules` and `coverage`.
- Run `npx create-next-app@16.4.3` with TypeScript, App Router, `src/` dir, the `@/*` alias, ESLint
  and **no Tailwind**. Then add Tailwind v3 and PostCSS.
- **Before writing app code, read** the `node_modules/next/dist/docs/` pages that cover:
  - layouts and fonts
  - the `proxy`/middleware rename
  - ESLint setup (`next lint` removal)
  - Turbopack defaults
  - caching changes

  Follow what the docs say, not memory.
- Scripts: `dev`, `build`, `start`, `typecheck` (`tsc --noEmit`), `lint` (`eslint .`),
  `test` (`vitest run`), `db:generate`, `db:migrate`, `db:studio`.
- Vitest uses a node environment and the `@/` alias, and covers `src/**/*.test.ts`.
- `server-only` package installed; `src/db/*` and `src/lib/env.ts` import it.

### Design tokens and global styles
- `tailwind.config.ts` maps every §2.1 colour, as `ph-*` and the semantic names used by the
  components. It also includes:
  - the font family (Poppins)
  - the type scale from §2.3 as `fontSize` entries (display, h1–h4, body-lg, body, body-sm,
    label, caption, price) with line heights, weights and letter spacing
  - radii sm 8 / md 12 / lg 16 / xl 20 / 2xl 24 / pill
  - shadows card / popover / focus
  - container max 80rem with 16 / 24 / 32px padding
  - `h-control` 44px and `h-control-lg` 48px
- `globals.css`:
  - the §2.2 CSS custom properties
  - `body` on canvas with ink text
  - a visible focus ring (`--ph-shadow-focus` plus outline)
  - `prefers-reduced-motion` handling
  - tabular numerals utility for prices
- Self-host Poppins 400/500/600/700 via `@fontsource/poppins`, importing only those weights.

### UI kit (`src/components/ui`)
Follow design system §4 for each component. Where relevant, each one must support default, hover,
`focus-visible`, active, disabled, loading and error states.
- **Button:** variants primary, secondary, ghost and danger; sizes md (44px) and lg (48px);
  `loading` shows a spinner, sets `aria-busy` and disables the button.
- **IconButton:** requires an `aria-label`; 44px target.
- **Input, Select, Textarea:** labelled through `Field`, which wires up label, hint and error
  (`aria-describedby`, `aria-invalid`).
- **Badge:** tones neutral, success, warning, danger, info, verified. The verified tone renders
  `BadgeCheck` plus the text **"Profile verified"**, never an icon alone.
- **Chip:** removable, with an accessible remove label.
- **SegmentedControl:** radio-group semantics and arrow-key navigation.
- **Skeleton, EmptyState and PageContainer:** container width plus responsive padding.
- `/styleguide` page shows every token (colour swatches with hex, type scale, radii, shadows) and
  every component state. It includes a client demo form that validates a Kenyan phone and shows the
  normalised E.164 and Daraja formats.

### Utilities (`src/lib`)
- `brand.ts`: name, tagline and description.
- `cn.ts`: `clsx` + `tailwind-merge`.
- `env.ts`: lazy Zod v4 validation (`getServerEnv()`), with empty strings treated as unset.
  - Error messages name the variables and never print their values.
  - Validate every server variable in `.env.example`; only `DATABASE_URL` is required, the rest are
    optional until the slice that uses them.
- `format.ts`:
  - `formatKes(n)` returns `KSh 45,000,000`; it handles 0 and rejects non-integers and negatives.
  - `formatKesCompact` (optional) for cards.
  - `formatNairobiDate` / `formatNairobiDateTime` use the `Africa/Nairobi` timezone.
  - Area formatters always carry a unit label.
- `kenya.ts`:
  - `normalizeKenyanPhone(input)` accepts `07xx`, `01xx`, `7xx`, `1xx`, `2547xx`, `2541xx`, `+254…`,
    spaces and dashes. It returns `{ e164: "+2547XXXXXXXX", daraja: "2547XXXXXXXX" }` or `null`.
  - `maskPhone(e164)` returns `+254 7•• ••• 678` for logs.
  - Constants: `KENYA_COUNTIES` (47), `AMENITIES`, `COMMERCIAL_SUBTYPES` (adapt from the reference).

### Database
- `drizzle.config.ts` uses `DATABASE_URL_UNPOOLED` for migrations, with schema at `src/db/schema.ts`
  and output in `drizzle/`.
- `src/db/index.ts` exports a lazy `getDb()` using the Neon HTTP driver with the pooled
  `DATABASE_URL`.
- `src/db/tx.ts` exports `withTransaction(fn)` using the Neon WebSocket `Pool` (with the `ws`
  constructor on Node). Adapt it from the reference, closing the pool in `finally`.
- Migration `0000_extensions.sql`: `create extension if not exists pg_trgm;`
- Migration `0001_core_schema.sql`, generated from `schema.ts`:
  - **Enums:**
    - `app_role`: buyer_tenant, owner, agent, agency_admin, platform_admin, **billing_admin**
    - `listing_type`: sale, rent
    - `property_category`: house, apartment, land, commercial
    - `listing_status`: draft, pending_review, published, **paused**, rejected, rented, sold,
      withdrawn, archived
    - `rent_period`: week, month, year
    - `land_size_unit`: sqm, acre, hectare
    - `lister_type`: agent, owner, developer
    - `verification_status`: unverified, payment_pending, under_review, verified, rejected,
      expired, suspended
    - `agency_member_role`: admin, member
    - `report_status`: open, reviewing, resolved, dismissed
  - **Tables:**
    - `users`, `sessions`, `accounts`, `verifications` (Better Auth shape)
    - `user_roles`
    - `agencies`, `agency_members`
    - `lister_profiles` (without verification columns)
    - `properties`: as in the reference, but with `price_kes bigint`, no `featured`, plus
      `paused_at timestamptz` and `pause_reason text`
    - `property_images`, `favorites`, `inquiries`, `conversations`, `messages`
    - `verification_requests`: status enum, `submitted_at`, `decided_at`, `decided_by`,
      `decision_reason`, `review_expires_at`
    - `verification_documents` (private storage key only)
    - `verification_audit_log`, `listing_moderation_log`, `listing_reports`
  - **Constraints** (plan §6):
    - non-negative price and bedrooms
    - positive area and land size
    - rent period only on rent listings
    - valid coordinate ranges
    - message and inquiry length 1–5000
    - one open report per reporter per listing (partial unique index)
  - **Indexes:** public search composite, owner, published desc, public coords, and a trigram GIN
    index on `title` and `town` for search.
  - **Append-only:** a trigger rejects UPDATE and DELETE on `verification_audit_log` and
    `listing_moderation_log`.
- The schema must not contain any exact-coordinate column that a public select helper could expose.
  Exact columns are named `exact_*` so later public query builders can exclude them explicitly.

### Docs and env
- `.env.example` uses placeholders only, grouped and commented. Groups:
  - App: `NEXT_PUBLIC_APP_URL`
  - Neon: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `TEST_DATABASE_URL`
  - Auth: `BETTER_AUTH_SECRET`
  - R2: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BUCKET`,
    `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BASE_URL`
  - Email: `RESEND_API_KEY`, `EMAIL_FROM`
  - Rate limits: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
  - Jobs: `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`
  - M-Pesa: `MPESA_ENV` (sandbox|production), `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`,
    `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_TOKEN`, `MPESA_CALLBACK_BASE_URL`
  - SMS: `AT_USERNAME`, `AT_API_KEY`, `AT_SENDER_ID`
  - Maps: `NEXT_PUBLIC_MAP_TOKEN` (Phase 3)
- `README.md`: setup, Neon branch setup (dev and test), scripts table, structure, and the decisions above.
- `docs/implementation-plan-v2.md`: a faithful markdown transcription of the v2.0 PDF (all 16
  sections, tables and checklists).

### Pages
- `layout.tsx`: metadata from `brand.ts`, Poppins, `lang="en-KE"`, a skip-to-content link.
- `page.tsx`: a simple placeholder home (brand, tagline, link to `/styleguide`). The real home page
  is S7.
- `not-found.tsx` styled with the kit.

## Security requirements

- No secrets in the repo; `.env.example` holds placeholders only. Never read or copy
  `../propertyhub-phase1-final/propertyhub/.env`.
- DB clients and env are `server-only`. Nothing under `src/db` or `src/lib/env.ts` is importable
  from client components.
- Env errors print variable names, never values.
- No browser-to-database path exists.

## Acceptance criteria

1. `npm run typecheck`, `npm run lint`, `npm test` and `npm run build` all pass with **no** `.env.local`.
2. `/styleguide` renders every token and component state. The phone demo turns `0712 345 678` into
   `+254712345678` / `254712345678` and rejects `0812345678`.
3. Unit tests cover at least:
   - `formatKes` (0, 45,000,000, rejects 1.5 and −1)
   - Nairobi date formatting across a UTC day boundary
   - every accepted and rejected phone shape
   - `maskPhone`
   - env lazy validation (missing `DATABASE_URL` throws only when called; the message has no values)
4. `npm run db:generate` produces no diff after the committed migrations, so schema and SQL agree.
5. With a Neon dev branch configured, `npm run db:migrate` applies `0000` and `0001` cleanly. The
   append-only triggers reject an UPDATE on `listing_moderation_log`.
6. The rendered pages at 1280px and 390px show no horizontal overflow, keyboard focus is visible on
   every control, and every icon-only button has an accessible name.
7. The first git commit contains no `.env` file.

## Checks to run

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run db:generate   # expect "No schema changes"
```

## Manual test steps (after implementation)

1. `npm install`
2. `npm run dev`, open `http://localhost:3000`. You should see the placeholder home. Open `/styleguide`.
3. On `/styleguide`:
   - tab through every control and confirm the focus ring is visible
   - try phone inputs `0712345678`, `+254 712 345 678`, `0112345678`, `0812345678`
   - resize to 390px wide and confirm there is no sideways scroll
4. Database (needs a Neon project):
   1. Create branches `dev` and `test` in the Neon console.
   2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` (pooled, `-pooler` host) and
      `DATABASE_URL_UNPOOLED` (direct) from the `dev` branch.
   3. Run `npm run db:migrate`.
   4. In the Neon SQL editor, run `select unnest(enum_range(null::listing_status));`. The result
      should include `paused`.
5. Optional integration tests: set `TEST_DATABASE_URL` to the `test` branch's direct URL, run
   `npm run db:migrate` against it, then `npm test`.
