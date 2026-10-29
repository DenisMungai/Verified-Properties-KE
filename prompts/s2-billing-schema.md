# S2 — Billing schema and entitlements

## Goal

Add the database and domain foundation for paid listing plans and the verification add-on (plan
v2.0 §4, §6, §9 "Listing plans and M-Pesa billing"):

1. Migration `0002_billing` with `plans`, `subscriptions`, `invoices`, `payments`,
   `payment_events` and `billing_audit_log`, plus their database rules.
2. A single database definition of "verified right now", which both the badge and search ranking
   read.
3. Pure, unit-tested entitlement and billing-period logic in `src/lib/billing/`.
4. Server-side queries that later slices call: the lister's listing plan, active-listing count,
   publish entitlement and verified status.
5. An idempotent operator script that seeds placeholder sandbox plans.

**Not in this slice:**
- Daraja calls, STK Push and callbacks (S5)
- pricing, plan picker and billing pages (S6)
- QStash jobs for reminders, grace expiry and pausing (S9)
- admin billing screens (S10)
- upgrade proration and credits (S5/S6)

No UI changes.

## References read

- `AGENTS.md` §1, §4–§10
- Plan v2.0:
  - §1: plans and the agency limit shared across members
  - §4: payment flow, payment security, billing rules, the lapse table, paid verification rules
  - §5: ranking reads the derived badge
  - §6: billing tables and the derived badge
  - §9: Listing plans and M-Pesa billing
  - §14: payments and trust signals
  - §16: defaults (no free tier, 3-day grace)
- `~/.claude/plans/above-is-the-scope-immutable-torvalds.md`, S2 section
- Daraja: the STK Push `AccountReference` and the Paybill account number hold at most 12
  characters. This sets the invoice number format.

## Existing code inspected

- `src/db/schema.ts`:
  - The enums, `properties` (with `status`, `paused_at`, `pause_reason`) and `lister_profiles.agency_id`.
  - `agencies` and `agency_members`.
  - `verification_requests` (`status`, `review_expires_at`, and the check "verified has an expiry").
  - The header comment already promises the badge is derived in S2.
- `drizzle/0001_core_schema.sql`:
  - Hand-written SQL is appended after the generated statements: the `reject_audit_log_change()`
    trigger function and the two append-only triggers.
  - Drizzle does not track that SQL, so `db:generate` still reports no diff. S2 follows the same
    pattern.
- `src/db/index.ts` (HTTP client), `src/db/tx.ts` (`withTransaction`), and `src/db/executor.ts`
  (`DbExecutor`, which accepts the HTTP client, a transaction or node-postgres).
- `src/db/queries/roles.ts`: the style for query modules, which take a `DbExecutor` as their first
  argument.
- `src/db/schema.integration.test.ts`: tests run inside BEGIN/ROLLBACK, use savepoints for
  statements expected to fail, and are skipped without `TEST_DATABASE_URL`.
- `scripts/create-admin.ts`: the operator-script pattern (node-postgres pool, `*_CONFIRM=yes`
  guard, PowerShell usage in the header).
- `package.json` scripts, `vitest.config.mts`, `drizzle.config.ts`.
- The reference v1.1 build has no billing, so nothing is adapted from it.

## Decisions and assumptions

Please check these when approving. Items 4, 6, 8 and 10 are product rules I've filled in.

1. **Who owns a subscription.** Each subscription has two nullable owner columns,
   `owner_user_id` and `owner_agency_id`.
   - A check makes sure exactly one of them is set.
   - Verification subscriptions always belong to a user, because the badge is per lister.
2. **Plan kind lives on the subscription too.** `subscriptions.kind` is kept in step with the
   plan by a composite foreign key: `(plan_id, kind)` references `plans (id, kind)`. A listing
   subscription therefore can't point at a verification plan.
3. **One live subscription per owner per kind.** Partial unique indexes allow only one row per
   (owner, kind) while the status is `pending`, `active`, `past_due` or `paused`. Renewals extend
   the existing row and add a new invoice; they don't create a new subscription.
4. **Whose listing plan applies (the listing pool).**
   - A lister with `lister_profiles.agency_id` set uses **their agency's** listing subscription.
   - The agency's limit is shared: it counts every listing with `properties.agency_id` = that
     agency.
   - Every other lister uses their own subscription and counts listings where they are the
     `owner_user_id`.
   - An agency member's personal plan is ignored while they belong to the agency.
5. **Plans are versioned and their terms are immutable.**
   - `plans` is unique on `(code, version)`.
   - A partial unique index allows only one active version per code.
   - A trigger rejects any UPDATE to `code`, `version`, `kind`, `price_kes`, `listing_limit` or
     `is_agency_plan`. Only `name` and `is_active` can change.
   - A price change is a new version, as AGENTS.md §7 requires.
6. **What counts as an "active listing" towards the limit:** `published` **plus**
   `pending_review`.
   - Counting listings in review reserves their slot, so an admin approval can never push a lister
     over the limit.
   - `paused`, `draft`, `rejected`, `rented`, `sold`, `withdrawn` and `archived` don't count.
7. **Periods and grace (plan §4).**
   - A period is 30 days. Grace lasts 3 days, and `grace_ends_at` = `current_period_end` + 3 days.
   - When a payment is confirmed, the new period starts at the later of the confirmation time and
     the current period end. Renewing early adds 30 days to the paid-up time and never shortens it.
   - Constants live in one place (`src/lib/billing/constants.ts`).
8. **Entitlement is computed from time as well as status.** A missed job therefore never grants
   access after grace. A subscription is in one of these phases:
   - **active**: status is `active` or `past_due`, and now < `current_period_end`.
   - **grace**: same statuses, and `current_period_end` ≤ now < `grace_ends_at`. Live listings stay
     live and the badge stays.
   - **lapsed**: after `grace_ends_at`, or a `paused`, `expired` or `cancelled` status.
   - **pending**: not paid yet.

   **Publishing or un-pausing needs the *active* phase.** During grace, existing listings stay up,
   but new publishes and un-pauses are refused with "Renew your plan to publish". The plan says
   publishing is blocked when the plan is inactive, and grace exists to protect what is already
   live.
9. **Verified right now is defined once, in SQL.**
   - A view `verified_listers_now(user_id)` lists everyone who meets all three conditions:
     - a `verification_requests` row with `status = 'verified'` and `review_expires_at > now()`.
       A suspension changes that row's status, so a suspended lister drops out.
     - a verification subscription in the active or grace phase. Plan §4 says the badge stays
       during grace.
     - a listing plan for their listing pool in the active or grace phase.
   - A SQL function `lister_verified_now(user_id) returns boolean` reads the view.
   - Search ranking joins the view (S7). The badge and server code call the function through
     `isListerVerified()`.
   - Missing data means unverified.
10. **Invoice numbers come from a Postgres sequence.** The format is `VPK` followed by 7 digits
    (e.g. `VPK0000042`). That is 10 characters, so it fits the 12-character Daraja account
    reference used for the Paybill fallback. The `invoices` columns `invoice_number`, `amount_kes`,
    `plan_id` and `subscription_id` are immutable (trigger).
11. **Payments allow for both STK Push and C2B.**
    - `checkout_request_id` and `mpesa_receipt` are nullable and UNIQUE; Postgres allows many nulls.
    - A check requires `checkout_request_id` when `method = 'stk_push'`.
    - A `confirmed` payment must have a receipt and `confirmed_at`.
    - An amount mismatch sets status `flagged` with a `flag_reason` and is never confirmed. This
      gives S5 the plan §4 rule in the database.
12. **The audit tables are append-only.**
    - `payment_events` and `billing_audit_log` reuse the `reject_audit_log_change()` trigger
      function from 0001.
    - `payment_events.payment_id` and `invoice_id` are nullable, so unmatched or forged callbacks
      are still recorded.
    - `billing_audit_log` requires an actor and a non-empty reason.
13. **Plans are seeded by a script, not the migration.** Placeholder prices must never become
    permanent rows in production.
    - Run it with `PLANS_SEED_CONFIRM=yes npm run plans:seed`. It is idempotent
      (`on conflict (code, version) do nothing`).
    - It seeds version 1 of:

      | Code | Kind | Limit | Agency plan | Price (KES) |
      |---|---|---|---|---|
      | `starter` | listing | 3 | no | 1 |
      | `pro` | listing | 20 | no | 2 |
      | `agency` | listing | 100 | yes | 3 |
      | `verification` | verification | none | no | 1 |

    - Real prices are added later as version 2.
14. **Money** is whole KES in `integer` columns: plan prices and invoice and payment amounts are far
    below 2³¹. Checks: plan price ≥ 0, invoice amount > 0, payment amounts ≥ 0. The listing limit
    must be > 0 for listing plans and null for verification plans.
15. **Migrations run on the dev and test branches only.** I run `npm run db:migrate` on the dev
    branch, and on the test branch by pointing `DATABASE_URL_UNPOOLED` at `TEST_DATABASE_URL` for
    that one command. The `production` branch is left alone until you ask.

## Files likely to change

```text
src/db/schema.ts                         billing enums, sequence, 6 tables, header comment
drizzle/0002_billing.sql                 generated + appended triggers, view, function
drizzle/meta/0002_snapshot.json          generated
drizzle/meta/_journal.json               generated
src/lib/billing/constants.ts             BILLING_PERIOD_DAYS, GRACE_DAYS, ACTIVE_LISTING_STATUSES, plan codes
src/lib/billing/periods.ts               nextPeriod, graceEndsAt, subscriptionPhase
src/lib/billing/periods.test.ts
src/lib/billing/entitlements.ts          canPublish, remainingSlots, pickListingsToKeep
src/lib/billing/entitlements.test.ts
src/db/queries/billing.ts                getActivePlans, getListingPool, getListingSubscription,
                                         countActiveListings, getPublishEntitlement, isListerVerified
src/db/billing.integration.test.ts       DB rules + verified-now truth table + agency pool count
scripts/seed-plans.ts                    operator-only sandbox plan seed
package.json                             "plans:seed" script
README.md                                billing schema notes, plans:seed, migrate steps
```

## Implementation requirements

### Schema (`src/db/schema.ts`, new "Billing" section)

- **Enums:**
  - `plan_kind`: listing, verification
  - `subscription_status`: pending, active, past_due, paused, cancelled, expired (plan §6)
  - `invoice_status`: open, paid, void, refunded
  - `payment_status`: pending, confirmed, failed, cancelled, flagged
  - `payment_method`: stk_push, c2b_paybill, manual
- **Sequence:** `invoice_number_seq` (`pgSequence`).
- **`plans`:**
  - Columns: `id` uuid, `code`, `version` int (default 1), `kind`, `name`, `price_kes` int,
    `listing_limit` int (nullable), `is_agency_plan` bool (default false), `is_active` bool,
    timestamps.
  - `unique(code, version)` and `unique(id, kind)`, the second as the target of the composite FK.
  - Partial unique index on `code` where `is_active`.
  - Checks:
    - `price_kes >= 0`
    - `(kind = 'listing') = (listing_limit is not null)`
    - `listing_limit is null or listing_limit > 0`
    - `not is_agency_plan or kind = 'listing'`
- **`subscriptions`:**
  - Columns: `id`, `owner_user_id` → users, `owner_agency_id` → agencies, `kind`, `plan_id`,
    `status` (default `pending`), `current_period_start`, `current_period_end`, `grace_ends_at`,
    `cancelled_at`, timestamps.
  - Composite FK `(plan_id, kind)` → `plans (id, kind)`.
  - Checks:
    - exactly one owner is set
    - `kind = 'listing' or owner_agency_id is null`
    - the period columns are all null or all set, with end > start and grace ≥ end
    - status `active`, `past_due` or `paused` requires the period columns
  - Partial unique indexes on `(owner_user_id, kind)` and `(owner_agency_id, kind)` where the
    status is `pending`, `active`, `past_due` or `paused`.
  - Index on `(status, grace_ends_at)` for the S9 jobs.
- **`invoices`:**
  - Columns: `id`, `invoice_number` (unique, default `'VPK' || lpad(nextval('invoice_number_seq')::text, 7, '0')`),
    `subscription_id`, `plan_id`, `amount_kes` int, `status` (default `open`), `period_start`,
    `period_end`, `paid_at`, `voided_at`, timestamps.
  - Checks:
    - `amount_kes > 0`
    - `invoice_number ~ '^VPK[0-9]{7,9}$'`
    - status `paid` requires `paid_at` and both period columns
    - period columns are both null or end > start
  - Index on `(subscription_id, created_at desc)`.
- **`payments`:**
  - Columns: `id`, `invoice_id`, `method`, `phone_e164`, `checkout_request_id` (unique),
    `merchant_request_id`, `mpesa_receipt` (unique), `amount_kes`, `paid_amount_kes`, `status`
    (default `pending`), `result_code` int, `result_desc`, `flag_reason`, `raw_callback` jsonb,
    `confirmed_at`, timestamps.
  - Checks:
    - `amount_kes >= 0`, and `paid_amount_kes` is null or ≥ 0
    - `method <> 'stk_push' or checkout_request_id is not null`
    - status `confirmed` requires `mpesa_receipt` and `confirmed_at`
    - status `flagged` requires `flag_reason`
  - Indexes on `invoice_id` and `phone_e164` (admin search, S10).
- **`payment_events`:**
  - Columns: `id`, `payment_id` (nullable), `invoice_id` (nullable), `event_type` text
    (`stk_callback`, `stk_query`, `c2b_validation`, `c2b_confirmation`, `status_change`,
    `reconciliation`), `source_ip`, `payload` jsonb not null, `created_at`.
  - Indexes on `(payment_id, created_at)` and `(invoice_id, created_at)`.
- **`billing_audit_log`:**
  - Columns: `id`, `actor_user_id` (not null), `action` text, `subscription_id`, `invoice_id`,
    `payment_id` (all nullable), `amount_kes` (nullable, ≥ 0), `reason` text not null with
    `char_length(trim(reason)) > 0`, `created_at`.
  - Index on `(created_at desc)`.
- **Foreign keys:** billing rows are never cascaded away. FKs to users, agencies, plans,
  subscriptions, invoices and payments use the default `no action`.

### Migration `drizzle/0002_billing.sql`

1. `npm run db:generate -- --name billing`.
2. Append hand-written SQL, commented as in 0001, with `--> statement-breakpoint` separators:
   - append-only triggers on `payment_events` and `billing_audit_log`, using the existing
     `reject_audit_log_change()`
   - `reject_plan_terms_change()` and its BEFORE UPDATE trigger on `plans`
   - `reject_invoice_terms_change()` and its BEFORE UPDATE trigger on `invoices`
   - `listing_plan_active(user_id text)` view helper, or an equivalent CTE inside the view, that
     resolves the listing pool (decision 4)
   - view `verified_listers_now` (decision 9)
   - `lister_verified_now(p_user_id text) returns boolean language sql stable`
3. A second `db:generate` must then report **no schema changes**.

### Domain logic (`src/lib/billing/`, pure, no DB, no `server-only` needed)

- **`constants.ts`:** `BILLING_PERIOD_DAYS = 30`, `GRACE_DAYS = 3`,
  `ACTIVE_LISTING_STATUSES = ["published", "pending_review"] as const`, and the plan codes.
- **`periods.ts`:**
  - `nextPeriod({ confirmedAt, currentPeriodEnd })` returns `{ start, end, graceEndsAt }`.
  - `graceEndsAt(periodEnd)`.
  - `subscriptionPhase(sub, now)` returns `"pending" | "active" | "grace" | "lapsed"`.
  - All of them take `now` explicitly; nothing reads the clock.
- **`entitlements.ts`:**
  - `canPublish({ subscription, listingLimit, activeListingCount, now })` returns
    `{ ok: true, remaining }`, or `{ ok: false, reason }` with reason one of `no_plan`,
    `plan_pending`, `plan_in_grace`, `plan_lapsed` or `limit_reached`. Un-pausing uses the same
    check.
  - `remainingSlots(limit, count)` never goes below zero.
  - `pickListingsToKeep(listings, limit)` keeps the newest by `publishedAt`, with id as the
    tie-break, for the restore and downgrade rules in plan §4.
  - A user-facing message map per reason, in plain sentences.
- **Types:** explicit, with no `any`.

### Queries (`src/db/queries/billing.ts`, `server-only`, each takes a `DbExecutor` first)

- `getActivePlans(db, kind?)`: active plans ordered by price.
- `getListingPool(db, userId)`: returns `{ kind: "agency", agencyId }` or
  `{ kind: "user", userId }`.
- `getListingSubscription(db, pool)`: the live listing subscription and its plan limit, or null.
- `countActiveListings(db, pool)`: counts listings using `ACTIVE_LISTING_STATUSES`.
- `getPublishEntitlement(db, userId, now = new Date())`: combines the three above with `canPublish`.
  It is the single entry point S3 will call.
- `isListerVerified(db, userId)`: `select lister_verified_now($1)`. Nothing in TypeScript
  re-implements the rule.

### Seed script (`scripts/seed-plans.ts`)

- Follows the `create-admin.ts` pattern: refuses without `PLANS_SEED_CONFIRM=yes` and prints the
  database host (never the full URL).
- Inserts the four plans from decision 13, then prints a table of what was inserted or already
  existed.

### Docs

- README:
  - a "Billing data model" section (tables, derived badge, listing pool)
  - `plans:seed` usage in bash and PowerShell
  - a migrate note for S2
- No new environment variables.

## Security requirements

- Prices and limits come only from `plans` rows. Nothing in this slice accepts a price, limit,
  plan kind or status from the browser.
- The badge has no stored flag anywhere. `verified_listers_now` and `lister_verified_now` are the
  only definition, and the default is unverified.
- Payment money rules are backed by the database:
  - unique `checkout_request_id` and `mpesa_receipt`
  - non-negative amounts
  - `flagged` can never be `confirmed`
  - invoice terms are immutable
  - plan terms are immutable
- `payment_events` and `billing_audit_log` reject UPDATE and DELETE, even from the app's own role.
- The phone is stored in E.164. Code in this slice never logs phones, payloads or receipts.
- The seed script is operator-only, needs explicit confirmation and never prints secrets.
- Query modules import `server-only`.

## Acceptance criteria

1. `0002_billing.sql` applies cleanly on the dev and test branches. A second `db:generate`
   reports no schema changes.
2. The integration tests show:
   - Plans: changing `price_kes` or `listing_limit` fails, renaming one works, and a second active
     version of a code fails.
   - A verification plan with a listing limit fails, and a listing plan without one fails.
   - A subscription with both owners or neither fails, and an agency-owned verification
     subscription fails.
   - A listing subscription pointing at a verification plan fails (composite FK).
   - A second live listing subscription for the same owner fails. A new one after the old one is
     `expired` succeeds.
   - Invoice numbers match `VPK\d{7}` and increase. Changing `amount_kes` fails.
   - A duplicate `checkout_request_id` or `mpesa_receipt` fails. `confirmed` without a receipt
     fails. `flagged` without a reason fails.
   - UPDATE and DELETE on `payment_events` and `billing_audit_log` fail. An empty audit reason
     fails.
   - `lister_verified_now` is **true** only for:
     - a verified, unexpired review + an active verification subscription + an active listing plan
     - the same during either subscription's grace
     - an agency member whose agency holds the active listing plan

     It is **false** for:
     - no review
     - an expired review
     - a suspended review
     - a lapsed verification subscription
     - a lapsed listing plan
     - payment with no review
   - `countActiveListings` for an agency pool counts all members' published and pending listings,
     and ignores paused and draft ones.
3. Unit tests cover:
   - the period maths: early renewal extends from the period end, late renewal starts at
     confirmation, and grace is exactly 3 days
   - each `subscriptionPhase` boundary (exactly at `period_end` and exactly at `grace_ends_at`)
   - every `canPublish` reason, and the limit edge (count = limit − 1 passes, count = limit fails)
   - `pickListingsToKeep` ordering and ties
4. `plans:seed` run twice inserts 4 rows, then 0. Without the confirm variable it exits non-zero.
5. Typecheck, lint, unit tests, integration tests and the build all pass.

## Checks to run

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration   # Neon test branch, after migrating it
npm run build
npm run db:generate        # expect "No schema changes" after 0002
```

## Manual test steps (after implementation)

1. Apply the migration to your dev branch: `npm run db:migrate`.
2. Seed the sandbox plans:
   - bash: `PLANS_SEED_CONFIRM=yes npm run plans:seed`
   - PowerShell: `$env:PLANS_SEED_CONFIRM="yes"; npm run plans:seed`

   You should see Starter, Pro, Agency and Verification. Run it again: nothing new is inserted.
3. Open `npm run db:studio` (or the Neon SQL editor on the dev branch) and try:
   - `update plans set price_kes = 5 where code = 'starter';` must fail with "plan terms are
     immutable"
   - `update plans set name = 'Starter plan' where code = 'starter';` must succeed
   - `select lister_verified_now('<your user id>');` must return `false`, because there is no
     review or subscription yet
4. Run `npm run test:integration` to watch the full billing rule set against the test branch.
5. There is nothing to click in the app yet. The pricing page and payments arrive in S5 and S6.
