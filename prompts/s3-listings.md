# S3 — Listing management

## Goal

Listers create, edit, submit and manage their own listings (plan v2.0 §9 "Listing management"):

1. A create flow following design "04 — Create Listing": the **Basics → Details → Preview** steps.
   Every step saves a draft. Photos is step 3 in the design and is added in S4.
2. Server-side Zod validation that ignores any status, featured, ranking, owner or agency values
   the client sends.
3. **Submit** with the v2.0 rules:
   - The S2 entitlement check (`getPublishEntitlement`) runs first, every time.
   - A verified lister's listing publishes at once (`lister_verified_now`).
   - An unverified lister's listing goes to `pending_review`.
4. Status actions:
   - Mark a listing rented, sold, withdrawn or archived.
   - Withdraw a submission back to draft.
   - Un-pause, which needs entitlement.
   - Delete a draft that was never submitted.
5. A material edit by an unverified lister sends a published listing back to review.
6. Agency-aware permissions: the owner or an agency admin of the listing's agency.
7. A **My listings** page and an "Active listings x / limit" card plus an **Add a property**
   button on the account overview (design "01 — Lister Dashboard").

**Not in this slice:**
- photos and the photo requirement (S4)
- public listing pages and search (S7/S8)
- the admin approve/reject queue (S8)
- buying a plan (S5/S6)
- views and enquiry stats (S8 and Phase 2)

## References read

- `AGENTS.md` §1–§10.
- Plan v2.0:
  - §1: categories, listing types, Buy/Rent/Land
  - §4: entitlement, the active-listing limit, paused listings
  - §6: listing statuses and constraints
  - §9: listing management and the exit criteria
  - §14: trust signals, authorization, localisation, accessibility
  - §16: moderation default, so only unverified listers are reviewed
- `~/.claude/plans/above-is-the-scope-immutable-torvalds.md`, S3.
- Design `3 - Lister & Admin Dashboards/`:
  - **04 — Create Listing**: the 4-step stepper, the "Property basics" card, the "A stronger
    listing" tips panel with "Your current plan: 12 of 20 active listings used" and a progress
    bar, and the **Save draft** (secondary) and **Continue →** (primary) buttons.
  - **01 — Lister Dashboard**: stat cards, **+ Add a property**, and the "Your listings" table
    (Property, Location, Views, Status, Action) with status colours: Published in Forest, In review
    in warning-text, Draft in Charcoal.
- Next 16 docs (`node_modules/next/dist/docs/01-app/01-getting-started/`):
  - `03-layouts-and-pages.md`: `params` is a Promise
  - `07-mutating-data.md`: Server Actions, `redirect`, `refresh`/`revalidatePath`
- Reference v1.1 (read-only), adapted rather than copied:
  - `src/lib/listing-workflow.ts` (+ test): the transitions, material fields and status labels
  - `src/lib/validation/listing.ts` (+ test): the category rules and `parseListing`, which reports
    every error at once
  - `src/lib/slug.ts` (+ test)
  - `src/db/queries/listings.ts`: the `manageable()` rule, and updates guarded on the status that
    was read
  - `src/app/account/listings/*` and `src/components/listings/ListingForm.tsx`

## Existing code inspected

- **`src/db/schema.ts`:**
  - `properties` has every v2.0 field (`subtype`, `zoning_notes`, `paused_at` and `pause_reason`,
    `exact_*` coordinates), and its checks cover rent period, land unit, positive area and so on.
  - `description` is NOT NULL with no default.
  - Also `agency_members` (role `admin`/`member`), `lister_profiles.agency_id` and
    `listing_moderation_log`.
- **`src/db/queries/billing.ts` (S2):** `getPublishEntitlement`, `getListingPool`,
  `countActiveListings`, `isListerVerified`. `ACTIVE_LISTING_STATUSES` is published plus
  pending_review.
- **`src/lib/billing/entitlements.ts`:** `PUBLISH_BLOCK_MESSAGES`.
- **The account area:**
  - `layout.tsx` (sidebar plus Suspense) and `AccountNav`
  - `nav.ts` `accountLinks()`, which shows only built pages
  - `page.tsx` overview, `PageHeading`, and `actions.ts`, which uses the `ActionState` /
    `keepValues` / `fieldErrorsFrom` pattern
  - `requireUser()` and `requireRole()` in `src/lib/session.ts`, and `LISTER_ROLES` in `roles.ts`
- **UI kit:** `Field`, `Input`, `Select`, `Textarea`, `SegmentedControl`, `Chip`, `Badge`, `Button`,
  `EmptyState`, `Skeleton`, `FormAlert`, `FormSkeleton`, `useFocusFirstError`.
- **Helpers:**
  - `src/lib/kenya.ts`: `KENYA_COUNTIES`, `AMENITIES`, `COMMERCIAL_SUBTYPES`
  - `src/lib/format.ts`: `formatKes`, `formatAreaSqm`, `formatLandSize`, Nairobi dates
  - `src/lib/rate-limit.ts`: `POLICIES`, `checkRateLimits`

## Decisions and assumptions

Please check these when approving. Items 3, 5, 6 and 9 are product rules I've filled in.

1. **The steps are separate pages, and each saves a draft:**
   - `/account/listings/new`: Basics. **Continue** or **Save draft** creates the draft.
   - `/account/listings/[id]/basics`, `/account/listings/[id]/details` and
     `/account/listings/[id]/preview`.

   The stepper shows Basics, Details and Preview. S4 inserts Photos as step 3, matching the
   design's four steps. Steps can be revisited in any order. Preview lists whatever is missing.
2. **What each step collects:**
   - **Basics** (design fields plus what the DB requires):
     - title
     - listing type (For sale / For rent segmented control)
     - property category
     - county
     - **town**, which the DB requires (e.g. "Nairobi City", "Ruiru")
     - area / neighbourhood
     - price (KSh)
     - rent period (only when For rent)
     - bedrooms (houses and apartments only)

     The Basics step holds every NOT NULL column, so a draft can be created from it. The
     description starts as `''`.
   - **Details:**
     - description
     - bathrooms (homes)
     - built area m² (not land)
     - land size and unit (land)
     - furnished (not land)
     - parking spaces (not land)
     - amenities as checkboxes (not land)
     - commercial subtype and zoning notes (commercial)
3. **Two levels of validation, so drafts can be incomplete:**
   - **Step schemas** validate only that step's fields. They allow saving a draft with fields that
     are missing but not invalid. For example, an empty description is fine, but a negative
     price is not.
   - **Submit** runs the full `listingSchema` (adapted from v1.1, written for Zod v4) on the
     **stored** row:
     - title 10–120 characters, description 30–4,000
     - price > 0
     - the category rules: rent period for rent; bedrooms and bathrooms for homes; land size and
       unit for land; subtype for commercial
     - bathrooms in whole or half numbers

     Fields that don't apply to the category are nulled on save, so stored data stays consistent
     with the DB checks.

   Unknown form keys (status, featured, owner, agency, slug) never reach the schema output.
4. **Slug:** `makeSlug(title)` (from v1.1), with a random 6-hex suffix, set once on create and
   never changed by edits, so links stay stable.
5. **Who can manage a listing:**
   - The owner (`owner_user_id`), or
   - an **agency admin** (`agency_members.role = 'admin'`) of the listing's `agency_id`.

   Plain agency members manage only their own listings. This is stricter than v1.1, where any
   member could, because the plan says "an authorized agency member".

   On create:
   - `agency_id` is copied from the creator's `lister_profiles.agency_id`, never from the form.
   - Only users with a lister role (`agent`/`owner`) and a lister profile can create. Others are
     sent to `/account/onboarding`.
6. **The submit rule, in one transaction:**
   1. Lock the listing pool with `pg_advisory_xact_lock(hashtext('pool:' || key))`. Two parallel
      submits then can't both take the last slot.
   2. Re-read the listing under the manage rule.
   3. Validate the stored row.
   4. `getPublishEntitlement` for the **owner's** pool.
   5. Then:
      - `lister_verified_now(owner)` → `published`, with `published_at = now()`
      - otherwise → `pending_review`

   Allowed from `draft` and `rejected`, which clears `rejection_reason`.

   If entitlement blocks, the preview shows the S2 message (for example "Choose a listing plan to
   publish your listings.") and a link to `/account/billing`, which S6 builds. Until then it reads
   "Listing plans open soon".
7. **The status transitions a lister may make** (pure `listerCanTransition`, adapted):

   | From | To |
   |---|---|
   | draft | submit → published or pending_review (rule 6); delete (hard) if never submitted |
   | pending_review | draft (withdraw submission) |
   | rejected | submit; draft; archived |
   | published | rented (rent only), sold (sale only), withdrawn, archived |
   | paused | un-pause → published (needs entitlement, same lock as rule 6; no re-review: pausing is billing, not moderation); withdrawn; archived |
   | rented / sold / withdrawn | archived |
   | archived | nothing |

   Approve, reject and pause are never lister actions. Every update is guarded on the status that
   was read, and returns `conflict` if it changed meanwhile.

   "Never submitted" means `published_at is null and reviewed_at is null`. Deleting an earlier
   draft would remove history; archive it instead.
8. **Material edits** (v1.1 rule):
   - The material fields are title, description, category, listing type, county, town and
     neighbourhood.
   - If an **unverified** owner makes a material change to a `published` listing, it goes back to
     `pending_review`. It keeps its slot, because pending_review counts towards the limit.
   - A verified owner's listing stays published.
   - Price, facts and amenities are not material.
   - Editing is allowed in draft, rejected, pending_review, published and paused.
9. **Paused listings** stay editable and keep their status when edited. Un-pausing goes straight
   back to `published` once entitled.
10. **Rate limit:** at most 20 new drafts per user per hour (`listingCreatePerUser`). Other listing
    actions are already bounded by session plus ownership. Production without Upstash refuses to
    run, as in S1.
11. **Overview and nav:**
    - "My listings" is added to `accountLinks()` for listers, after Overview.
    - The overview gains an "Active listings" stat card: "x / limit" with "n slots available", or
      "No plan yet — drafts are free". It also gets the **+ Add a property** primary button.
    - The other design stat cards (Enquiries, Views, Verification) wait for their slices, so there
      are no fake numbers.
    - The listings table drops the **Views** column until views are tracked.
12. **Location privacy:** S3 collects no coordinates; maps and pins arrive in Phase 3. The
    `public_*` and `exact_*` columns stay null.
13. **No public page.** The Preview step shows the lister a "how buyers will see it" summary inside
    the account area. The public detail page arrives in S8.

## Files likely to change

```text
src/lib/listings/workflow.ts (+ .test.ts)    statuses, labels, listerCanTransition, material edit, editable
src/lib/listings/slug.ts (+ .test.ts)        makeSlug
src/lib/validation/listing.ts (+ .test.ts)   basicsSchema, detailsSchema, listingSchema (submit), form readers
src/lib/rate-limit.ts                        listingCreatePerUser policy
src/db/queries/listings.ts                   canManage SQL, listManageable, getManageable, createDraft,
                                             updateBasics/updateDetails, submitListing, unpauseListing,
                                             transitionListing, deleteDraft
src/db/queries/listings.integration.test.ts
src/app/account/listings/page.tsx            My listings table
src/app/account/listings/actions.ts          create/update/submit/transition/delete Server Actions
src/app/account/listings/new/page.tsx        Basics (create)
src/app/account/listings/[id]/basics/page.tsx
src/app/account/listings/[id]/details/page.tsx
src/app/account/listings/[id]/preview/page.tsx
src/components/listings/ListingStepper.tsx
src/components/listings/BasicsForm.tsx, DetailsForm.tsx      client forms (useActionState)
src/components/listings/PlanUsagePanel.tsx   "A stronger listing" + current plan
src/components/listings/ListingStatusBadge.tsx
src/components/listings/ListingActions.tsx   status buttons with confirm for destructive ones
src/components/listings/ListingSummary.tsx   preview card + facts
src/components/layout/nav.ts                 "My listings"
src/app/account/page.tsx                     Active listings card + Add a property
README.md
```

## Implementation requirements

### Domain (pure, unit-tested)

- `workflow.ts`:
  - `LISTER_EDITABLE_STATUSES`
  - `listerCanTransition(from, to, { listingType })`
  - `MATERIAL_FIELDS`, `isMaterialEdit`
  - `statusAfterEdit(current, material, ownerVerified)`
  - `STATUS_LABELS`: Draft, In review, Published, **Paused**, Needs changes, Rented, Sold,
    Withdrawn, Archived
  - `STATUS_TONES`, mapped to Badge tones
- `listing.ts` validation: Zod v4 (`{ error }`), errors in plain sentences, and form readers for
  each step.
  - `parseListing` reports every problem at once, so the lister doesn't fix one batch of errors
    only to meet another.
  - Prices accept "8,500,000" and become whole shillings. Values that aren't integers are
    rejected.

### Queries (`server-only`, each takes a `DbExecutor`)

- `manageableBy(userId)` SQL: `owner_user_id = $user` or `agency_id in (agencies where $user is
  admin)`.
- Every read and write applies it, so a forged id returns `not_found`, never another lister's row.
- The editor never selects `exact_*` columns.
- Writes take the status that was read as a guard. Submit and un-pause run inside
  `withTransaction` with the pool lock.
- Result types are unions, for example `{ ok: true, status }` or
  `{ ok: false, reason: "not_found" | "not_allowed" | "conflict" | "invalid" | "entitlement" }`,
  with the entitlement or field details attached.

### Server Actions (`src/app/account/listings/actions.ts`)

Each action:
- calls `requireUser()`
- checks for a lister role and profile (for create)
- validates with Zod
- calls one query
- returns `ActionState` or redirects

The rest:
- Errors never leak internals. They are logged as `[listings] <action> failed <error.name>`, with
  no listing content or personal data.
- After a mutation, `refresh()` or `redirect`:
  - Continue goes to the next step.
  - Save draft stays on the page with "Draft saved".
  - Submit goes to `/account/listings?submitted=<status>`.
- The listing id comes from a hidden field and is re-checked by `manageableBy`. It is never
  trusted.

### UI (design 04 and 01, tokens only)

- **Page shell:**
  - `PageHeading`: "Create a property listing", with description "Add accurate details so buyers
    and tenants can make informed decisions."
  - When editing, the title is "Edit listing" and the description is the listing title.
- **Stepper:**
  - A white card (`rounded-xl border-line`, padding 24, 8pt rhythm) holding an `<ol>` of step
    links: "1 Basics", "2 Details", "3 Preview".
  - The current step is in Forest `emerald-700` with font-medium and `aria-current="step"`. The
    others are in `slate-600`.
  - On new listings, steps after Basics are plain text until the draft exists.
  - At 390px it stays one row, with smaller gaps and labels kept.
- **Layout:**
  - `lg:grid-cols-[minmax(0,1fr)_22rem]`, gap 32.
  - The form card is white, `rounded-xl`, padding 32 (24 on mobile), with an "h3"-size card title
    ("Property basics" / "Property details").
  - The **tips panel** is `bg-mint-50 rounded-xl p-6`:
    - title "A stronger listing" in `emerald-700` at `text-h4`
    - five ✓ tips from the design, in `emerald-700` body-sm; the check icon is decorative and the
      text carries the meaning
    - then "Your current plan" with "x of y active listings used" and a progress bar
      (`role="progressbar"` with aria values; Forest fill on a `line` track)
    - or "No listing plan yet. Drafts are free; you'll need a plan to publish."

    It stacks under the form below `lg`.
- **Fields:** two-column grids at `md` and up (category | county, price | bedrooms), as in the
  design, and one column on mobile.
  - Listing type uses `SegmentedControl` ("For sale" / "For rent"). The selected option has a
    Forest border on mint, matching the design.
  - Conditional fields (rent period, bedrooms, land, commercial) show or hide on the client as the
    category or type changes. The server enforces the same rules.
  - Amenities are a checkbox grid (2 columns on mobile, 3 on `md`) with 44px rows.
  - Every control is `h-control` (44px) with `line-strong` borders, labels above, and inline
    errors linked with `aria-describedby`. The first error is focused on submit
    (`useFocusFirstError`).
- **Footer:** **Save draft** (secondary) on the left and **Continue →** (primary) on the right.
  On mobile both are full width, with Continue first in visual order. Pending state uses a
  `Spinner` and disabled buttons.
- **Preview:**
  - `ListingSummary`: title, `formatKes` price plus "/ month" for rent, location
    "Neighbourhood, Town, County", fact chips (beds, baths, area or land size with units), and the
    description, with paragraphs kept and rendered as plain text.
  - A **checklist** of what's missing for submit, linking to the step that fixes each item.
  - The submit panel:
    - entitled and ready → **Submit for review**, or **Publish** when verified, plus one line
      explaining what happens next
    - blocked → the S2 message plus the link or "opens soon" text
- **My listings:**
  - `PageHeading` "My listings" plus **+ Add a property**.
  - A table at `md` and up (Property, Location, Status, Updated, Action) using the design's
    row style: `bg-canvas` rows, `rounded-lg`, 8px gaps.
  - Below `md` it becomes stacked cards.
  - Status uses `ListingStatusBadge` (text label, never colour alone).
  - The Action column is contextual: Continue (draft), Edit, Review (in review), Un-pause
    (paused), and a "More" menu for rented, sold, withdrawn, archived and delete. Destructive
    actions need a confirm step: a `<details>` disclosure or a second button. No `window.confirm`.
  - A "Needs changes" row shows the rejection reason.
  - The empty state is `EmptyState` with "List your first property" and **Add a property**.
  - Success banners use `?submitted=published|pending_review` → `FormAlert`.
- **Cache Components:** every page that reads the session, params or the DB renders inside
  `<Suspense>` with a skeleton (`FormSkeleton`, or table skeleton rows). No route `runtime`
  exports.

## Security requirements

- Every action and page re-checks the session and `manageableBy`. The proxy is never relied on.
  A forged or foreign listing id gives a 404 page or a `not_found` result.
- Status, published_at, reviewed fields, owner, agency, slug and pause fields are **never** read
  from form data. Tests prove a forged `status=published` field is ignored.
- Entitlement and verified status are decided on the server (S2 queries) at submit and un-pause
  time, inside the locked transaction.
- Unverified listers can never reach `published` from a draft. A material edit returns the
  listing to review.
- Descriptions and titles render as text and never as HTML. Zod lengths are backed by the DB
  checks.
- No exact coordinates are collected or selected.
- The draft-creation rate limit is in place. Logs carry no listing text or personal data.

## Acceptance criteria

1. Unit tests cover:
   - every allowed and forbidden transition, including rented only for rent and sold only for
     sale
   - `statusAfterEdit` for verified versus unverified owners
   - the material versus non-material field lists
   - step schemas that accept a partial draft and reject invalid values
   - `listingSchema` category rules, field nulling and comma prices
   - `parseListing` reporting all missing cross-field errors at once
   - the slug shape and stability
2. Integration tests on the test branch show:
   - **Create:** the creator's agency_id is copied, and a forged `status` is ignored, so the
     listing stays a draft.
   - **Manage rule:**
     - the owner can edit
     - their agency admin can edit
     - a plain member of the same agency cannot
     - a stranger gets `not_found`
   - **Submit:**
     - no plan → `entitlement/no_plan` and the status is unchanged
     - an active Starter plan and an unverified owner → `pending_review`
     - with a verified owner (review plus both subscriptions) → `published` with `published_at`
       set
     - the 4th submit on Starter (limit 3) → `limit_reached`
     - an incomplete draft → `invalid` with field list
   - A material edit by an unverified owner sends published back to pending_review. A price edit
     does not.
   - Un-pause works with an active plan and is refused in grace.
   - Rented on a sale listing → `not_allowed`.
   - Deleting a submitted listing → `not_allowed`. Deleting a never-submitted draft succeeds.
3. The browser walkthrough (Edge via playwright-core) at **1280px and 390px** finds no horizontal
   overflow and no console errors. It checks:
   - create → details → preview → blocked by "Choose a listing plan"
   - with a plan (inserted by SQL on the dev branch) → submitted → "In review" in My listings
   - mark withdrawn, then archive
   - keyboard: the stepper and all fields are reachable, and errors are announced and focused
4. Typecheck, lint, unit tests, integration tests and the build pass. `db:generate` reports no
   schema changes, because S3 needs no migration.

## Checks to run

```bash
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run db:generate   # expect "No schema changes"
```

Plus the browser pass at 1280px and 390px (Edge via playwright-core in the scratchpad).

## Manual test steps (after implementation)

1. `npm run dev`. Sign in as a lister (finish onboarding if needed), then open **My listings** and
   click **+ Add a property**.
2. Fill in Basics:
   - "Modern 3-bedroom apartment in Kilimani"
   - For rent, Apartment, Nairobi, town "Nairobi", neighbourhood "Kilimani"
   - price `85,000`, monthly, 3 bedrooms

   Click **Continue**. Fill in Details, click **Continue** and check the Preview.
3. **Submit** must be blocked with "Choose a listing plan to publish your listings."
4. Give yourself a sandbox plan on the **dev** branch (Neon SQL editor):

   ```sql
   insert into subscriptions (owner_user_id, kind, plan_id, status,
     current_period_start, current_period_end, grace_ends_at)
   select u.id, 'listing', p.id, 'active', now(), now() + interval '30 days', now() + interval '33 days'
   from users u, plans p where u.email = '<your email>' and p.code = 'starter' and p.is_active;
   ```

5. Reload Preview and click **Submit for review**. My listings shows it as **In review**, and the
   overview shows "1 / 3".
6. Make two more listings and submit them. A 4th submit must say you've reached your plan's limit.
7. Use **Withdraw submission** on one, then delete a never-submitted draft.
8. Resize to 390px and repeat step 2. Nothing should scroll sideways, and the buttons should be
   full width.
9. Approving listings arrives in S8. Until then, to see `published`, run
   `update properties set status = 'published', published_at = now() where id = '<id>';`, then
   try **Mark as rented** and **Archive**.
