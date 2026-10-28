# VerifiedPropertiesKE Implementation Plan v2.0

Oct 21, 2026 · @Denis

> Markdown transcription of *VerifiedPropertiesKE Implementation Plan v2.0.pdf*. The PDF is the
> original; this copy exists so agents and prompts can cite sections. Do not change the scope here
> without the user's say-so.
>
> **Repository status note (2026-10-28):** the "Where things stand" paragraph below describes the
> old PropertyHub repo. This repository is a fresh rebuild: Phase 0 is being rebuilt to the v2.0
> spec (slice S0), then Phase 1 follows in slices S1–S11. See `AGENTS.md`.

VerifiedPropertiesKE (formerly PropertyHub) is a Kenyan property marketplace where agents,
agencies, owners and developers pay a monthly subscription to list property, and pay a separate
monthly fee for a verified tick that ranks them first in search and on the home page. Buyers and
tenants search, save listings and contact listers for free. It runs on Next.js and Neon Postgres,
with M-Pesa as the payment method from launch.

Version 2.0 replaces v1.1. What changed:

- **Paid listings.** Every lister needs an active listing subscription to publish. Plans differ by
  how many active listings they allow.
- **Paid verification.** The verified tick is a monthly add-on. Paying buys an admin review, not
  the badge itself. The badge shows only while the review has passed and the subscription is paid.
- **Priority ranking.** Verified listers appear first in search results and own the home-page
  featured slots, with fair rotation among them.
- **M-Pesa moved into the core build.** Daraja STK Push, callbacks and reconciliation are now
  Phase 1 work, not a post-launch option.
- **Stack fixes.** Upstash QStash for background jobs, a Google Maps versus Mapbox test before
  Phase 3, polling for chat at launch.
- **New defaults.** Verified listers' phone numbers are public. Only unverified listers' listings
  are reviewed before going live.

> **Where things stand:** Phase 0 (foundation) is complete and delivered as
> propertyhub-phase0.zip. Phase 1 (marketplace MVP with listing subscriptions) is next. With
> billing added, the estimate is about 9 to 12 weeks to launch for one full-stack developer.

## 1. Product scope and business model

Listers pay and seekers use the site for free. Revenue comes from two monthly subscriptions: one
to list, one for the verified tick.

| Audience | What they do on VerifiedPropertiesKE | Pays? |
|---|---|---|
| Buyers and tenants | Search by location, price, category and Buy/Rent/Land; save listings; contact listers; report suspicious listings | Free |
| Agents and agencies | Subscribe to a listing plan, create and manage listings, answer inquiries, optionally buy verification | Listing plan, optional verification |
| Property owners and developers | Same listing workflow as agents, on the same plans | Listing plan, optional verification |
| Platform admins | Moderate listings, review verification requests, manage plans and payments, handle abuse reports; every action audited | Internal |

Property categories are house, apartment, land and commercial. Listing types are sale and rent.
The Buy / Rent / Land control maps onto both: Buy and Rent filter by listing type, Land filters by
category.

**Listing subscription.** A lister can create drafts for free but needs an active plan to
publish. Plans set how many listings can be live at once. An agency plan covers all its members
under one bill. Suggested tiers (prices to be set):

| Plan | Active listings | Who it suits | Price (KES / month) |
|---|---|---|---|
| Starter | 3 | Private owners, new agents | To be set |
| Pro | 20 | Independent agents | To be set |
| Agency | 100, shared across members | Agencies and developers | To be set |

**Verification subscription.** A monthly add-on on top of any listing plan. It gives the verified
tick, top placement in search, eligibility for home-page featured slots and public phone numbers.
Payment starts an admin review. The tick appears only after the review passes, and only while
both subscriptions are paid.

**Priority ranking.** Verified listers' published listings rank above unverified ones in every
search and fill the home page's featured sections first. Section 5 sets out how ranking works and
how it is disclosed.

## 2. Architecture and stack

The core stack is unchanged from v1.1. Four rows changed: payments are new, and jobs, maps and
realtime were revised.

| Layer | Choice | Notes |
|---|---|---|
| Web app | Next.js (App Router), TypeScript | Server Actions and Route Handlers; no direct browser-to-database access |
| UI | Tailwind CSS v3, Poppins | Tokens from Design System v1.0; fonts self-hosted via @fontsource |
| Database | Neon Postgres | Pooled connection for the app, direct for migrations; branches for dev, previews and tests |
| ORM and migrations | Drizzle ORM and Drizzle Kit | Better PostGIS support than Prisma |
| Validation | Zod | Shared between forms and server handlers |
| Authentication | Better Auth | Email and password, email verification, reset |
| **Payments (new)** | **M-Pesa Daraja API (STK Push)** | Subscription payments from launch. Card payments through Paystack are an optional Phase 5 addition |
| File storage | Cloudflare R2 | Public bucket for listing images; private bucket for verification documents |
| **Background jobs (changed)** | **Upstash QStash** | Replaces Vercel Cron: retries, backoff, scheduled and delayed jobs, signed requests. Covers renewals, reminders, expiry and payment checks |
| **Maps and geocoding (changed)** | **Google Maps or Mapbox, decided by test** | Test both on 50 real Kenyan addresses before Phase 3; keep the provider behind an adapter |
| Email | Resend | Notifications, receipts and renewal reminders, with minimal personal data |
| SMS (new, optional) | Africa's Talking | Renewal and payment-failure reminders, since many listers act on SMS faster than email |
| Rate limiting | Upstash Redis | Login, signup, inquiries, messages, autocomplete, payment start |
| **Realtime chat (changed)** | **Polling every 10 to 15 seconds** | Avoids Vercel function time limits on server-sent events; move to Ably or Pusher only if users notice delay |
| Search | Postgres full-text search with pg_trgm | Enough at launch; no separate search service |
| Testing | Vitest and Playwright | Unit, integration and critical end-to-end flows, including payment callbacks against the Daraja sandbox |
| Hosting and monitoring | Vercel, Neon, an error-monitoring provider | Structured logs with no secrets or personal data |

Privileged keys (database URLs, storage secrets, Daraja consumer key and secret, passkey, QStash
signing keys, email and map secrets) stay server-side. Only the app URL and a restricted public
map token reach the browser. A committed .env.example documents every variable with placeholder
values only.

## 3. Moving from Supabase to Neon

Neon is plain serverless Postgres, so each feature Supabase bundled gets an explicit replacement.

| Blueprint assumed | Replacement with Neon |
|---|---|
| Supabase Auth and auth.users foreign keys | Own users table shaped for Better Auth; all foreign keys point to users(id) |
| Supabase Storage | Cloudflare R2 with presigned uploads; separate private bucket for verification documents |
| Row Level Security as the main defense | Authorization in a server-side data-access layer; every query scoped by the session. RLS can be added later as defense in depth |
| Supabase Realtime for chat | Polling at launch; Ably or Pusher only if needed |
| Supabase client in the browser | No direct database access from the browser; all reads and writes go through Server Actions and Route Handlers |

Neon practices:

- Use the pooled connection string at runtime and the direct one for migrations.
- Use separate Neon branches for development, preview deployments and the Playwright test
  database, so tests never touch production data.
- The HTTP driver does not support interactive transactions. Add a WebSocket pool client in
  Phase 1. Payment confirmation needs it: marking a payment paid, extending the subscription and
  restoring listings must commit together.
- Rely on Neon point-in-time restore for backups and rehearse a restore before launch.

## 4. Subscriptions, payments and entitlements

Payments go through M-Pesa STK Push. The server, never the browser, decides what a lister is
entitled to, based on confirmed payments only.

**Payment flow**

1. The lister picks a plan or the verification add-on and confirms their M-Pesa number.
2. The server creates a pending payment with an invoice number and sends an STK Push through
   Daraja.
3. The lister enters their M-Pesa PIN on their phone.
4. Safaricom calls the callback URL with the result. The server records the raw callback, then
   confirms the result with the STK Push Query API before trusting it.
5. On success, one database transaction marks the payment paid, extends the subscription by one
   billing period and restores any paused listings or badge.
6. The lister gets an on-screen confirmation, an emailed receipt and an SMS if enabled.

If STK Push fails or times out, the lister can pay manually to the Paybill using their invoice
number as the account number. A C2B confirmation callback matches it to the invoice.

**Payment security**

- Daraja callbacks are not signed. Protect the callback URL with a secret path token, accept only
  Safaricom's published IP ranges, and always confirm with the Query API.
- Make every write idempotent. The CheckoutRequestID and the M-Pesa receipt number are unique in
  the database, so a repeated callback changes nothing.
- Never trust amounts or plan IDs from the browser. Prices come from the plans table at the moment
  the invoice is created.
- A nightly reconciliation job compares paid invoices with M-Pesa transaction records and flags
  mismatches for admins.
- Rate-limit payment starts per user and per phone number to stop STK Push spam.

**Billing rules**

- A billing period is 30 days from the confirmed payment.
- Reminders go out 5 days and 1 day before expiry, by email and SMS, each with a one-tap Renew
  link that starts a new STK Push.
- An upgrade takes effect at once, with unused days credited. A downgrade takes effect at the end
  of the period.
- Optional auto-renewal: evaluate M-Pesa Ratiba standing orders and Paystack card billing in
  Phase 5. At launch, renewal is a manual STK Push.
- Receipts carry an invoice number, plan, period and amount. Confirm KRA eTIMS invoicing and VAT
  treatment with an accountant before launch.

**When a subscription lapses**

| What lapses | Grace period | After grace | On renewal |
|---|---|---|---|
| Listing plan | 3 days, listings stay live with a renewal banner | Listings move to paused and leave search; drafts, photos and inquiries are kept | Paused listings return automatically, up to the plan's limit |
| Verification add-on | 3 days, badge stays | Badge, priority ranking, featured slots and public phone number are removed | Restored at once if the last approved review has not expired; otherwise a new review is needed |
| Listing plan while verified | The badge depends on an active listing plan | Badge is removed with the listings | Both return when both are paid |

If a downgrade leaves more live listings than the new plan allows, the lister chooses which stay
live. If they don't choose within 3 days, the newest ones stay live and the rest are paused.

**Paid verification rules**

- Paying starts a review. It never grants the badge by itself.
- A passed review is valid for 12 months, then needs re-review. The monthly payment keeps the
  badge visible during those 12 months.
- Admins can suspend a badge for fraud or abuse at any time, whether or not the lister has paid.
  The terms must say this.
- Rejected reviews: the default is that the first month's verification fee is refunded or
  credited to the listing plan. Section 16 lists the alternatives.

## 5. Search ranking and front-page placement

Verified listers rank first in the default sort and fill the home page's featured slots. Rotation
and per-lister caps stop a few large agencies from taking every top spot. The ranking is computed
on the server from stored subscription and verification status. Listers cannot set it.

**Search results**

- The default sort, Recommended, has two tiers. All matching listings from verified listers come
  first, then everyone else.
- Within each tier, listings are ordered by a score: how well they match the filters, how recent
  they are, and listing quality (photo count, complete fields).
- Within the verified tier, a daily rotation shuffles listings with similar scores, so the same
  agent is not always first.
- Each lister can hold at most 3 of the first 20 results on a page. Their other listings still
  appear further down.
- When the user picks Newest or Price, their sort is applied strictly. Up to 3 matching verified
  listings appear above the results in a strip labelled "Verified listers".
- Ranking only reorders results. A verified listing never shows up for filters it does not match.

**Home page**

- Featured sections (for example "Featured in Nairobi" and "Verified agents") show verified
  listers only.
- A listing must meet a quality bar to be featured: at least 5 photos, a cover image, and every
  required field filled in.
- At most 2 listings per lister in each section, rotated daily.
- If there are not enough verified listings, the remaining slots show newest published listings
  without the Featured label.

**Disclosure**

- Search results show a short line: "Verified listers appear first. Verification is a paid service
  that includes an identity and business check."
- A help page explains what the tick checks, that it is paid, and how ranking works.
- The badge says "Profile verified". It never implies a legal license or a guarantee about a
  property.

**Measuring it**

Track views, saves and inquiries per listing, split by verified and unverified. Show verified
listers their own numbers on their dashboard, because that proves the value of renewing.

## 6. Data model decisions

The v1.1 model stays. Billing adds six tables and one new listing status, and the verified badge
now depends on payment as well as review.

- **Category separate from listing type.** listing_type is sale or rent; category is house,
  apartment, land or commercial.
- **Owners can list.** lister_profiles covers agents, private owners and developers. Roles:
  buyer_tenant, owner, agent, agency_admin, platform_admin, plus a new billing_admin for payment
  support.
- **The badge is derived, never stored as a flag.** A lister shows as verified only when three
  things are true: an approved review that has not expired, an active verification subscription,
  and an active listing plan. One database view or function computes this, and both search
  ranking and the badge read from it.
- **Location privacy.** Properties store a public approximate point and a separate private exact
  one. Public queries never return the exact point. PostGIS arrives in Phase 3.
- **Listing statuses:** draft, pending_review, published, paused (new: plan lapsed or over limit),
  rejected, rented, sold, withdrawn, archived. Only published listings appear in public search.
- **Database constraints** back up app validation: non-negative prices, positive areas, rent
  period only on rent listings, valid coordinates, message length limits, unique M-Pesa receipt
  numbers, non-negative payment amounts.
- **Money** is stored as whole Kenyan shillings in integer columns, never as floats.

**New billing tables**

| Table | Holds |
|---|---|
| plans | Plan code, kind (listing or verification), name, monthly price in KES, active-listing limit, active flag. Prices change by adding a plan version, never by editing a paid one |
| subscriptions | Owner (lister or agency), plan, status (pending, active, past_due, paused, cancelled, expired), current period start and end, grace end |
| invoices | Invoice number, subscription, amount, period covered, status (open, paid, void, refunded) |
| payments | Invoice, phone number (stored masked in logs), CheckoutRequestID, M-Pesa receipt number, amount, status, raw callback payload, confirmed-at time |
| payment_events | Append-only log of every callback, query result and status change, for reconciliation and disputes |
| billing_audit_log | Admin actions on billing: refunds, credits, manual activations, with who, when and why |

Tables already in the initial migration: users, user_roles, agencies, agency_members,
lister_profiles, properties, property_images, favorites, inquiries, conversations, messages,
verification_requests, verification_documents, verification_audit_log, listing_reports. The
billing tables arrive in a new Phase 1 migration.

## 7. Roadmap at a glance

Launch is about 9 to 12 weeks away, up from 7 to 10 in v1.1, because billing is now built from
Phase 1.

| Phase | Scope | Estimate | Status |
|---|---|---|---|
| Phase 0 · Foundation | Design tokens, UI kit, schema and migrations | 3 to 4 days | Complete (rebuilt here as S0) |
| Phase 1 · Marketplace MVP with listing plans | Auth, M-Pesa listing subscriptions, listings, photos, search, inquiries | 3 to 4 weeks | Next |
| Phase 2 · Paid verification and messaging | Verification add-on, priority ranking, featured slots, chat, alerts | 2 to 2.5 weeks | Planned |
| Phase 3 · Location experience | Maps provider test, PostGIS, List and Map search, location privacy | 1.5 to 2 weeks | Planned |
| Phase 4 · Hardening and launch | Security tests, M-Pesa go-live, accessibility, compliance | 1.5 to 2 weeks | Planned |
| Phase 5 · Growth features | Auto-renewal, annual plans, boosts, WhatsApp, reviews, saved searches | After launch | Optional |

Each phase ends with a review against its exit criteria before the next one starts. Work is
delivered one page or feature at a time.

## 8. Phase 0: Foundation (complete)

Phase 0 is done: the project skeleton, design system and full v1.1 schema are built and tested.

Delivered:

- Next.js, TypeScript and Tailwind project with the design system's colour, type, spacing and
  shadow tokens; Poppins self-hosted.
- Base components: Button, IconButton, Input, Select, Textarea, Badge, Chip, SegmentedControl,
  Skeleton, EmptyState, PageContainer, each with focus, disabled, loading and error states.
- A /styleguide page showing every token and component, including a form that validates Kenyan
  phone numbers and normalizes them to +254.
- Neon and Drizzle setup: complete schema, a migration enabling pg_trgm, and a second creating
  all tables.
- Lazy-validated environment config, KES formatting, Kenyan phone normalization, 18 passing unit
  tests.

Still to confirm:

- [ ] Run the migrations against a real Neon branch (npm run db:migrate) and fix anything that
  surfaces.
- [ ] Set up ESLint, Playwright and CI (scheduled for early Phase 1).

## 9. Phase 1: Marketplace MVP with listing subscriptions

Goal: an agent pays for a listing plan with M-Pesa, publishes a listing, and a buyer finds it,
saves it and sends an inquiry. Estimate: 3 to 4 weeks (v1.1 was 2 to 3; billing adds about a
week).

**Authentication and accounts**

- Better Auth with email and password, email verification, single-use expiring reset links,
  sign-out and session refresh.
- Sign-in and sign-up return the user to the listing or action that sent them there.
- Roles stored server-side; the first platform admin is created through an operator-only script,
  never public signup.
- Lister profile (display name, phone, public email, avatar, agency) and a buyer account area for
  saved listings.
- Rate limits on login, signup and reset; reset responses never reveal whether an account exists.

**Listing plans and M-Pesa billing**

- Billing migration: plans, subscriptions, invoices, payments, payment_events, billing_audit_log.
- Pricing page and plan picker, shown when a lister first tries to publish.
- Daraja integration: OAuth token caching, STK Push, callback handler, STK Push Query
  confirmation, C2B Paybill fallback. Build and test against the Daraja sandbox, then apply for
  production go-live early because Safaricom approval can take time.
- Entitlement checks on the server: publishing or un-pausing a listing is blocked when the plan
  is inactive or the active-listing limit is reached.
- Lister billing page: current plan, renewal date, active listings against the limit, invoices and
  receipts, Renew and Change plan buttons.
- QStash jobs: renewal reminders, grace-period expiry, pausing listings, nightly reconciliation.
- Admin billing screen: search payments by phone or receipt, view the event log, issue credits or
  refunds, manually activate after a verified Paybill payment. Every action goes in
  billing_audit_log.

**Listing management**

- Create-draft form: category, listing type, price, rent period, bedrooms, bathrooms, area, land
  size and unit, furnished, parking, amenities, county, town, neighbourhood, description.
  Commercial listings add subtype and zoning notes.
- Server-side Zod validation; status, featured, ranking and ownership values from the client are
  ignored.
- Workflow: draft, then submit. Listings from unverified listers go to pending_review for an admin
  to approve or reject with a reason. Listings from verified listers publish immediately and are
  checked through reports and spot checks.
- Owners can mark listings rented, sold, withdrawn or archived. Material edits to a published
  listing from an unverified lister return it to review.
- Agency-aware permissions: only the owner or an authorized agency member can edit a listing.

**Image pipeline**

- Direct-to-R2 presigned uploads, then server checks: JPEG, PNG and WebP only, file-signature
  verification, size and count limits.
- Generated storage keys, EXIF stripping, resized WebP variants and thumbnails with sharp, cover
  image selection, required alt text, branded fallback image.
- Cleanup of orphaned uploads through a QStash job.

**Public discovery**

- Search with the Buy / Rent / Land control, location, price range (min cannot exceed max),
  property type, bedrooms, bathrooms, furnished, parking and verified filters, and sorts
  (Recommended, Newest, price low to high and high to low).
- Recommended sort uses the two-tier ranking in section 5. Until Phase 2 delivers verification,
  every lister is in the unverified tier, but the ranking code ships now.
- Active filters as removable chips, Clear all, result counts, pagination, and a mobile filter
  drawer with Apply and Reset.
- Property card: 4:3 image, price, location, facts, lister identity, save button, with skeleton,
  empty and error states.
- Public queries return only published listings and only public fields. Paused listings never
  appear.

**Property detail, favorites, inquiries and moderation**

- Breadcrumbs, keyboard-accessible gallery with swipe, key facts, description with Show more,
  amenities, lister panel, Report listing action, similar listings.
- Save and unsave, with a sign-in return flow.
- Contact form creating an inquiry tied to the listing, with inline validation, preserved input on
  error and phone normalization. Unverified listers' phone numbers stay hidden until a signed-in
  inquiry.
- Admin moderation queue for unverified listers' listings, with approve or reject and a reason.

**Engineering tasks**

- Neon WebSocket pool client for transactional writes (payment confirmation first).
- ESLint, CI (typecheck, tests, build) and Neon preview branches.
- Seed script with clearly labelled sample data, sample plans and sandbox payments.

> **Exit criteria:** an agent signs up, pays for a Starter plan through the Daraja sandbox, creates
> a listing with photos and submits it; an admin approves it; it appears in search; a buyer saves
> it and sends an inquiry the agent can see. A duplicate callback does not double-extend the plan.
> When the plan lapses, the listing is paused after grace and returns on renewal. Unpublished and
> paused listings are never public.

## 10. Phase 2: Paid verification, messaging and notifications

Goal: a lister buys verification, passes review and immediately ranks first, and buyers and
listers can message each other. Estimate: 2 to 2.5 weeks.

**Paid verification workflow**

- Verification statuses: unverified, payment_pending, under_review, verified, rejected, expired,
  suspended. The badge shows only when the review is verified and both subscriptions are active
  (section 6).
- Flow: the lister picks the verification add-on, pays by STK Push, then uploads the required
  documents to the private R2 bucket. Collect only what the check needs. Documents are never
  served publicly.
- Admin review screen: approve or reject with a reason, with a target of 2 working days. Decisions
  are made on the server after role checks. Every action (submit, pay, view document, approve,
  reject, suspend, expire) goes to the append-only audit log.
- On rejection, apply the refund-or-credit rule from section 4 and tell the lister what to fix.
- On approval, the badge, ranking boost, featured eligibility and public phone number switch on
  at once. The lister's existing listings skip pre-review from then on.
- A passed review lasts 12 months. QStash sends re-review reminders 30 and 7 days before it
  expires. Lapsed payment or an expired review removes the badge automatically.
- Retention and secure deletion rules for documents, checked against the Kenya Data Protection
  Act.
- Lister dashboard: views, saves and inquiries, verified versus before, to show the value of
  renewing.

**Home page featured sections**

- Featured sections built on the rules in section 5: verified only, quality bar, 2 per lister,
  daily rotation, unlabelled fallback.
- The "Verified listers appear first" line in search and a help page on what verification checks
  and costs.

**In-app messaging**

- Conversations tied to a listing, a buyer and a lister, created or reused on first message. Inbox
  with unread counts on both sides.
- The sender must be a participant on every send. Message bodies are plain text, never HTML.
- Rate limits, spam-link handling, report-message and block actions, moderator access for abuse
  cases.
- Polling every 10 to 15 seconds on open conversations and the inbox badge.

**Notifications and jobs**

- Email through Resend, and SMS through Africa's Talking if adopted, with minimal personal data
  and a link back to the signed-in inbox or billing page.
- Idempotent QStash jobs for new-message alerts, payment receipts, renewal reminders, verification
  expiry, listing review reminders and cleanup, with retries, backoff and a failed-jobs view for
  admins.
- Delivery status recorded; a failed notification never loses the message or the payment.

> **Exit criteria:** a lister pays for verification in the sandbox, uploads documents, is approved
> and moves to the top of search and onto the home page. When their verification payment lapses,
> the badge and ranking go after grace and return on renewal without a new review. A rejected
> lister gets the refund or credit. A buyer and an agent exchange messages. Cross-user access to
> conversations, documents and billing records is shown to be blocked.

## 11. Phase 3: Location experience

Goal: search by place and by map without exposing owners' exact locations. The map provider is
chosen by test at the start of the phase. Estimate: 1.5 to 2 weeks.

**Provider test (first 2 days)**

- Run 50 real Kenyan addresses through Google Maps and Mapbox: Nairobi estates (Kilimani, Ruaka,
  Syokimau, Kitengela), satellite towns, and towns in Mombasa, Kisumu and Nakuru.
- Score autocomplete hits, geocoding accuracy at neighbourhood level, tile quality and the
  expected monthly cost at launch traffic.
- Pick the winner. Autocomplete and geocoding matter more than map looks. A split is allowed, for
  example Google for search and geocoding, Mapbox for tiles.

**Build**

- PostGIS in a new migration (geography column and spatial index), tested on a Neon branch first.
- A map adapter so UI components do not depend on the provider; keys restricted by allowed
  origins and APIs.
- Location autocomplete for county, town and neighbourhood: debounced, stale requests cancelled,
  server endpoint rate-limited.
- Server-side geocoding on save, with manual pin placement when geocoding fails.
- List and Map views with two explicit controls. Filters, sort, pagination and map bounds persist
  across views; selecting a pin highlights its card and the reverse.
- Verified listers' pins use the verified style, and the map's results list follows the same
  two-tier ranking as search.
- Pin clustering in dense areas, and a keyboard-accessible list for every pin.
- Privacy: public maps show approximate or neighbourhood-level points by default; exact points
  only when the lister opts in, never in public query results. Device location only after a tap
  on Locate me.
- Fallback message and a fully usable list if tiles or geocoding fail. Usage monitoring and budget
  alerts.

> **Exit criteria:** switching between List and Map keeps the search state; a map outage leaves
> search usable; a test confirms public responses contain no exact coordinates.

## 12. Phase 4: Production hardening and launch

Goal: make the platform safe to open and to take real money. This phase includes switching M-Pesa
from sandbox to production. Estimate: 1.5 to 2 weeks.

**Security and authorization tests**

- An anonymous user cannot read a draft, rejected or paused listing.
- Agent A cannot read or modify Agent B's drafts, invoices or payments; an agent cannot approve
  their own verification.
- Buyer A cannot read Buyer B's messages or favorites.
- A user cannot grant themselves a role, mark themselves verified, extend their own subscription
  or change their ranking.
- Publishing past the plan's listing limit, or with a lapsed plan, is refused by the server.
- Payment callbacks: a forged callback from outside Safaricom's IPs is rejected; a replayed
  callback does not double-credit; an amount that doesn't match the invoice is flagged, not
  activated.
- Public APIs never expose exact coordinates, verification documents, payment details or private
  columns.
- Rate limits stop obvious login, inquiry, messaging and STK Push abuse.
- Optional defense in depth: Postgres row-level policies driven by a per-request session setting.

**Payments go-live**

- Daraja production credentials, Paybill or Till number, passkey and callback URL configured in
  the hosting dashboard.
- A real KES 1 test payment end to end on production, then refund it.
- Reconciliation job running and its first report checked against the M-Pesa statement.
- Refund and dispute process written down for billing admins.

**Quality and operations**

- Playwright end-to-end flows: visitor searches and opens a property; buyer registers and saves;
  agent subscribes, creates and submits; admin approves; listing appears; agent buys verification
  and moves to the top; buyer inquires and agent replies; plan lapses and listing pauses; mobile
  List to Map keeps filters; invalid forms show accessible errors and keep values.
- Accessibility audit: keyboard access, visible focus, contrast, labelled controls, 44px targets,
  200% zoom, 320px width.
- Performance pass on images, query plans (ranking query especially) and layout shift.
- Error monitoring and alerts, including an alert when payment callbacks stop arriving.
  Structured logging, backup restore rehearsal, incident-response note.

**Compliance and content**

- Privacy notice, terms, subscription and refund policy, and a data-request route, reviewed
  against the Kenya Data Protection Act. This plan is technical guidance, not legal advice.
- A clear explanation of paid ranking and what verification checks, linked from search and the
  badge.
- KRA eTIMS invoicing and VAT treatment confirmed with an accountant.
- Moderation and listing-report process published; no dead links in header or footer.
- Production secrets only in the hosting dashboard; none in source control.

> **Exit criteria:** the launch checklist in section 15 is fully ticked.

## 13. Phase 5: Growth features (after launch)

After launch, the focus moves to making renewals easier and adding paid extras. M-Pesa is no
longer in this phase because it is part of the core build.

- **Auto-renewal:** M-Pesa Ratiba standing orders, if the API is available to the business, and
  Paystack card billing for listers who prefer cards.
- **Annual plans** at a discount, paid in one STK Push.
- **Paid boosts:** a one-off fee to bump a single listing to the top of its area for 7 days,
  clearly labelled Promoted, for listers who want more than the verified tier gives.
- **Agency pages** for verified agencies, with their team and all listings.
- **WhatsApp notifications** through the official WhatsApp Business Platform: explicit opt-in and
  opt-out, approved templates, verified webhooks, recorded delivery status. In-app messaging
  remains the source of truth.
- **Reviews and ratings** only once there is real review data. Placeholder ratings never appear on
  real listings.
- **Saved searches** with alerts, and similar-listing recommendations.

## 14. Cross-cutting rules

These rules apply in every phase. v2.0 adds rules for payments and paid ranking.

| Area | Rule |
|---|---|
| Trust signals | Never fake or infer verification, reviews, availability or locations. Default to unverified when data is missing. Payment alone never makes anyone verified |
| Paid ranking | Ranking boosts come only from server-side subscription and verification status. Paid placement is always disclosed. It reorders matching results and never adds listings that don't match |
| Payments | Confirm every payment with Safaricom before acting on it. Every payment write is idempotent. Prices come from the server. Money is stored as whole shillings in integers |
| Authorization | Every Server Action and route validates input, checks the session and permission, applies rate limits where abuse is possible, and returns typed errors without leaking internals |
| Localization | KES shown as KSh 45,000,000; Kenyan phone formats (07xx, 01xx, +254) normalized to E.164 and to 2547XXXXXXXX for Daraja; county, town and neighbourhood stored separately; timestamps in UTC, shown in Nairobi time; area units always labelled |
| Accessibility | Keyboard support, visible focus, WCAG AA contrast, 44px targets, text or icons alongside colour, reduced-motion support, list alternative to the map. The verified tick has a text label, not just an icon |
| Design fidelity | Markdown design tokens are the source of truth. The board's emerald values (#16834A, #116B3B) differ slightly from the specified tokens (#14833B, #087443) |
| Testing data | Seeded data, the Daraja sandbox and a dedicated Neon branch; never run destructive tests or real payments against production outside the go-live check |

## 15. Launch checklist

Every box is ticked before public launch.

**Data and listings**

- [ ] Migrations, including billing, applied and reviewed on Neon
- [ ] Public queries return only published listings; paused listings hidden
- [ ] Server-side validation on all property forms
- [ ] Image constraints and cleanup working
- [ ] Search, sort, filters, pagination and empty states tested

**Billing and payments**

- [ ] Daraja production credentials live and a real test payment confirmed
- [ ] Callbacks confirmed by the Query API, IP-restricted and idempotent
- [ ] Plan limits enforced on the server
- [ ] Grace, pause and restore working for listing plans
- [ ] Renewal reminders sent by email (and SMS if adopted)
- [ ] Nightly reconciliation running and checked
- [ ] Refund, credit and dispute process documented
- [ ] eTIMS and VAT treatment confirmed with an accountant

**Verification and ranking**

- [ ] Payment starts a review and never grants the badge directly
- [ ] Private document storage access-controlled
- [ ] Admin-only review and audit trail
- [ ] Badge derives from review status plus both active subscriptions
- [ ] Verified listers rank first, with rotation and per-lister caps
- [ ] Paid ranking disclosed in search and on the help page
- [ ] Retention and expiry rules defined

**Authentication**

- [ ] Email verification and password reset configured
- [ ] Roles cannot be self-assigned
- [ ] Authorization tests passing
- [ ] Rate limits configured, including STK Push

**Maps**

- [ ] Provider chosen by test; keys restricted by origin and API
- [ ] List/Map switch preserves state
- [ ] Autocomplete debounced and rate limited
- [ ] Approximate-location policy enforced
- [ ] Map outage fallback tested

**Messaging**

- [ ] Participant-only access tested
- [ ] Abuse reporting and rate limits work
- [ ] Retries idempotent and delivery recorded

**Operations**

- [ ] .env.example committed without secrets
- [ ] Production secrets set in hosting
- [ ] Backup and restore rehearsed
- [ ] Monitoring and alerts live, including payment-callback alerts
- [ ] Privacy notice, terms, subscription and refund policy, moderation process published
- [ ] Mobile, accessibility and security checks complete

## 16. Defaults and open decisions

The plan is built on these defaults. Prices are the main decision still open before Phase 1
billing work starts.

| Decision | Current default | Alternative |
|---|---|---|
| Plan prices | To be set before Phase 1 | Test two price points with the first 20 listers |
| Free tier | None: every published listing needs a plan | 1 free listing for private owners, to seed inventory at launch |
| Free trial | None | First month of Starter free for the first 100 listers |
| Rejected verification | First month's fee refunded or credited to the listing plan | Non-refundable review fee, stated before payment |
| Explicit sorts (Newest, Price) | User's sort applied strictly, with a labelled strip of up to 3 verified listings on top | Verified first in every sort |
| Grace period | 3 days | 7 days |
| Moderation | Only unverified listers' listings reviewed before going live | Review all listings |
| Contact details | Verified listers' phone numbers public; others hidden until a signed-in inquiry | Hidden for everyone until inquiry |
| Renewal | Manual STK Push with reminders | Ratiba or card auto-renewal at launch |
| Sold and rented listings | Removed from public search | Kept visible as past inventory |
| ORM | Drizzle | Prisma (weaker PostGIS support) |
| Authentication | Better Auth | Auth.js or Neon Auth |
| File storage | Cloudflare R2 | S3, Vercel Blob |
| Background jobs | Upstash QStash | Inngest |
| Maps provider | Chosen by the Phase 3 test | Google Maps or Mapbox decided now |
| Realtime chat | Polling | Ably or Pusher |
