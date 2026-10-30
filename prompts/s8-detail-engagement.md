# S8 — Listing detail, saved listings, inquiries, reports and moderation

## Goal

Close the Phase 1 loop (plan v2.0 §9 "Property detail, favorites, inquiries and moderation"):
an admin approves a listing, it appears in search, and a buyer opens it, saves it and sends an
inquiry the lister can see.

1. **Listing detail page** at `/properties/[slug]`:
   - breadcrumbs, title, the verified badge when it applies
   - a gallery that works with the keyboard and with swipe
   - price, key facts, the description with Show more, and amenities
   - a lister panel that follows the contact rules
   - an inquiry form, Save, Report listing, and similar listings
2. **Saving listings:** a heart on cards and on the detail page, and a real `/account/saved` page.
   Signed-out visitors are sent to sign in and come back to the same page.
3. **Inquiries:**
   - signed-in buyers send one from the detail page
   - listers read them at a new `/account/inquiries`
   - the lister's phone (and public email) is shown after the buyer's first inquiry, or always
     when the lister is verified
4. **Reports:** signed-in users report a listing with a reason.
5. **Admin moderation** (platform admins only):
   - a queue of `pending_review` listings, with a review page to approve, or reject with a reason
   - a report queue to dismiss a report, or take the listing down with a reason
   - every decision is written to the append-only `listing_moderation_log`
6. **Cards become links** to the detail page (the S7 `href` prop) and gain the heart.

**Not in this slice:**
- in-app messaging, and email or SMS alerts for new inquiries (Phase 2 notifications, QStash).
  Listers see inquiries on `/account/inquiries`.
- maps and the approximate-location pin (Phase 3)
- view, save and inquiry metrics (plan §5 "Measuring it")
- the "Recently viewed" and "Search alerts" tabs on Saved
- verification review and billing admin tools (Phase 2 and S10)

## References read

- `AGENTS.md` §§1–10: §6 (contact rule, moderation only for unverified listers, public
  visibility, trust signals), §8 (Zod, session, rate limits, typed errors), §5 (layers).
- Plan v2.0:
  - §6: statuses, location privacy
  - §9 "Property detail, favorites, inquiries and moderation" and the Phase 1 exit criteria
  - §10 "Notifications and jobs": alerts are Phase 2
  - §14: authorization, localization and accessibility rules
  - §16: contact details default (verified phones public, others after a signed-in inquiry)
- Slice plan S8 (`~/.claude/plans/above-is-the-scope-immutable-torvalds.md`).
- Designs:
  - `03 — Property Detail - Desktop`: breadcrumbs, title and badge row, mosaic gallery with
    "View all N photos", details chips, amenities, sticky price and contact card with "Request a
    viewing" and "Your details are shared only with this lister."
  - `05 — Saved Properties - Desktop`: heading, tab bar, card grid
  - `03 — Admin Console & Moderation`: stat cards, "Listings awaiting moderation" table (Listing,
    Lister, Submitted, Reason, Review), Quick actions
  - The mock's "✓ Verified listing" and "Verified property professional" become the plan wording
    "Profile verified" (`VerifiedBadge`), shown only when `lister_verified_now` is true.
- Next 16 docs: `page.md` (`params` is a Promise), `not-found.md`, `generate-metadata.md` (with
  Cache Components), `forms.md` and `updating-data.md` (Server Actions, `useActionState`,
  `useOptimistic`, `refresh`), `error.md` (`retry`).
- The v1.1 reference (`../propertyhub-phase1-final/propertyhub`), consulted only:
  - `app/properties/actions.ts`, `db/queries/inquiries.ts`, `favorites.ts`, `reports.ts`
  - `components/properties/Gallery.tsx`, `SaveButton.tsx`, `EngagementForms.tsx`
  - `app/admin/actions.ts` and the admin pages
  - It has no paused status, no derived badge and no plan check on approval; those are new here.

## Existing code inspected

- `src/db/schema.ts`:
  - `favorites` (primary key user and property)
  - `inquiries` (message 1–5000 characters, phone or email required, recipient index)
  - `listing_reports` (details ≤ 2000, one open report per reporter per listing)
  - `listing_moderation_log` (append-only by trigger), `lister_profiles` (phone, public email),
    `agencies`
- `src/db/queries/public-listings.ts` (S7): `publishedOnly`, card columns, `homeShowcase`,
  `searchListings`.
- `src/db/queries/listings.ts`: `manageableBy`, `photoSummaries`, `listingFieldsOf`.
- `src/db/queries/billing.ts`: `getListingPool`, `getListingSubscription`, `isListerVerified`;
  `src/lib/billing/periods.ts` `subscriptionPhase`.
- `src/lib/session.ts` (`getCurrentUser`, `requireUser`, `requireRole`), `src/lib/roles.ts`
  (`ADMIN_ROLES`), `src/lib/rate-limit.ts` (`POLICIES`, `rateLimitKey`),
  `src/lib/action-state.ts`, `src/lib/kenya.ts` (`normalizeKenyanPhone`, `displayKenyanPhone`),
  `src/lib/safe-redirect.ts` (`signInPath`).
- `PropertyCard` (S7 `href` prop), `ListingImage`, `ListingSummary` (`listingFacts`,
  `listingLocation`), `components/ui/*`, `AccountNav`, `nav.ts` `accountLinks`.
- `src/app/admin/page.tsx` (placeholder) and `src/app/account/saved/page.tsx` (empty placeholder).
- `src/app/account/listings/page.tsx`: already shows a rejection reason to the lister.

## Decisions and assumptions

Please check these when approving. **1, 3, 4 and 6 are the ones most worth your eye.**

1. **Contact rule:**
   - The contact shown is the listing owner's lister profile (`phone`, `public_email`). The agency
     name is the identity line, but the person who listed it gets the inquiries.
   - **Verified listers** (`lister_verified_now`): their phone shows on the page to everyone.
   - **Everyone else:** their phone and public email show only to a signed-in user who has sent at
     least one inquiry about this listing. They appear straight after a successful send, and on
     later visits.
   - Missing values are never invented. Without a phone, the panel says to wait for a reply.
2. **Inquiries are for signed-in users only** (the schema needs a sender). Signed-out visitors see
   "Sign in to contact this lister", which returns them to the listing.
   - **Fields:** name (prefilled from the account), phone (optional, normalised to E.164), email
     (prefilled, optional), message (10–2000 characters, prefilled "Hi, I'd like to arrange a
     viewing of this property. When is it available?"). At least one of phone or email is
     required.
   - The button reads **Request a viewing**, as in the design. The note under it reads "Your
     details are shared only with this lister."
   - **Refused:** your own listing (owner or agency admin), a listing that isn't published, more
     than 3 inquiries about the same listing in 24 hours, and an exact repeat of a message.
   - **Rate limit:** 10 per hour per user (Upstash).
   - Messages are stored trimmed and always rendered as text, never as HTML.
3. **Moderation is platform admins only.** `billing_admin` keeps the `/admin` overview but gets a
   404 on the moderation pages.
   - **Approve:**
     - only from `pending_review`, in one transaction with the row locked
     - requires the lister's listing plan to be **active** (not pending, in grace or lapsed),
       using the same pool rule as publishing
     - the listing already holds its plan slot while in review, so the limit isn't re-checked
     - otherwise it's refused with "The lister's plan isn't active, so this listing can't go live
       yet." and stays in the queue
     - sets `published`, `reviewed_at` and `reviewed_by`, and clears the rejection reason
     - `published_at` keeps its old value for a listing returning after an edit (so it doesn't
       jump to the top of Newest), and is set to now for a new one
   - **Reject:** a reason of 10–500 characters, status `rejected`. The lister already sees the
     reason on My listings and can edit and resubmit.
4. **Taking a listing down after a report** sets it to `rejected` with the admin's reason. There
   is no separate status.
   - The report, and any other open reports on that listing, become `resolved`.
   - **Dismiss** sets the report to `dismissed`.
   - Both are logged with the `report_id`.
   - A taken-down listing can be fixed and resubmitted, so it goes back through review.
5. **Reports:**
   - signed-in only; not on your own listing; only published listings
   - **reasons:** Scam or fraud, Wrong price or details, Already sold or rented, Duplicate listing,
     Offensive content, Other
   - optional details up to 2000 characters
   - a second open report from the same person gets "You've already reported this listing. Our
     team will review it."
   - **Rate limit:** 10 per hour per user
6. **Saving listings:**
   - **Signed-out heart:** a link to `/sign-in?next=<this page>`. After signing in, the visitor
     lands back on the same listing or search and taps again. Nothing is saved automatically from
     a URL, because a GET must never write.
   - **Signed-in heart:** a Server Action form, so it works without JavaScript, with an optimistic
     toggle.
   - Saving needs a published listing. Unsaving always works.
   - **Rate limit:** 120 per hour per user.
   - Search, home and similar-listing cards show saved state through one extra query for the ids
     on screen.
   - `/account/saved` lists saved listings that are still published (newest saved first), with a
     count. A saved listing that is paused or sold drops out of the list, and its row stays in
     case it returns.
7. **Detail page data:**
   - `getPublicListing(slug)` returns public fields only for a `published` row. Anything else is a
     404 (`notFound()`), including paused, sold, draft and in-review listings.
   - It includes the description, amenities, subtype, zoning notes, area and land size, and every
     photo in order (cover first).
   - **Never returned:** exact or public coordinates (the map is Phase 3), the owner id, the
     agency id, review fields and the pause reason.
   - The owner id is used only inside the server for "is this mine?" and the contact rule.
8. **Gallery** (client component):
   - **Desktop:** the design's mosaic (a large cover and up to 4 tiles) with "View all N photos".
   - **Mobile:** a horizontal scroll-snap strip. Swiping is native and needs no JavaScript.
   - **Full-screen viewer** (any photo, or View all): a `<dialog>` with previous and next buttons,
     arrow keys, swipe, a "3 / 12" live counter, Escape to close, and focus returned to the
     opener.
   - Listings without photos show the branded fallback.
   - `prefers-reduced-motion` turns off smooth scrolling.
9. **Description:** paragraphs as text. Longer than about 600 characters, it's clamped with a
   Show more / Show less button (`aria-expanded`). Without JavaScript the full text shows.
10. **Similar listings:**
    - up to 3 published listings with the same listing type and category, excluding this one
    - same town first, then same county, then newest
    - no verified boost, so there's no paid placement to disclose
    - the section is hidden when there are none
11. **Lister inbox** `/account/inquiries` (listers only):
    - shows inquiries for listings the user can manage (the S3 `manageableBy` rule: owner, or an
      admin of the listing's agency), newest first, up to 200
    - each shows the listing title (linked when it's still published), the sender's name, phone,
      email and message, and the time in Nairobi
    - **Unread:** an Unread badge, a "Mark as read" button per inquiry, and "Mark all as read"
    - "Inquiries" joins the lister account nav
    - Buyers don't get a sent-messages page in Phase 1
12. **Admin pages** follow the "Admin Console & Moderation" design, kept small:
    - `/admin` overview: stat cards for Published listings, Pending review and Open reports
      (platform admins), plus quick links. Billing admins see a note that billing tools arrive
      in S10.
    - `/admin/listings`: the queue table. Reason is "New listing" when it was never published,
      otherwise "Edited after publishing". Oldest first.
    - `/admin/listings/[id]`: the full preview (the S3 `ListingSummary`), the lister's name,
      email and plan status, the moderation history, and Approve or Reject.
    - `/admin/reports`: open reports with the listing, reason, details, reporter name and date,
      and Dismiss or Take down.
    - All these pages are `robots: noindex`.
13. **Caching:** none. Every page is dynamic inside `<Suspense>`. Server Actions call `refresh()`
    (or redirect with a notice) after writes.
14. **Metadata:**
    - **detail page:** the title, a description from the first 155 characters, an Open Graph
      image from the cover's 960px variant, and the canonical `/properties/[slug]`
    - **missing listings:** a plain 404
15. **No migration expected.** The existing tables, indexes and constraints cover this slice.

## Files likely to change

New:
- `src/lib/validation/engagement.ts` (`inquirySchema`, `reportSchema`, `decisionReasonSchema`,
  `REPORT_REASONS`), `engagement.test.ts`
- `src/lib/listings/contact.ts` (pure contact rule), `contact.test.ts`
- `src/db/queries/listing-detail.ts` (`getPublicListing`, `similarListings`)
- `src/db/queries/favorites.ts` (`setFavorite`, `savedIdsAmong`, `listSaved`)
- `src/db/queries/inquiries.ts` (`createInquiry`, `hasInquired`, `getListerContact`,
  `listReceived`, `markRead`, `unreadCount`)
- `src/db/queries/reports.ts` (`createReport`, `listOpenReports`)
- `src/db/queries/moderation.ts` (`moderationQueue`, `getListingForReview`, `approveListing`,
  `rejectListing`, `dismissReport`, `takeDownForReport`, `moderationHistory`, `adminCounts`)
- `src/db/queries/engagement.integration.test.ts`, `moderation.integration.test.ts`
- `src/app/properties/[slug]/page.tsx`, `src/app/properties/actions.ts` (save, inquiry, report)
- `src/app/account/inquiries/page.tsx` and `actions.ts`
- `src/app/admin/layout.tsx` (admin nav), `admin/listings/page.tsx`,
  `admin/listings/[id]/page.tsx`, `admin/reports/page.tsx`, `admin/actions.ts`
- `src/components/listing/`: `Gallery` (client), `Description` (client), `FactsList`,
  `ListerPanel`, `InquiryForm` (client), `ReportForm` (client), `SaveButton` (client),
  `SimilarListings`
- `src/components/admin/`: `AdminNav`, `DecisionForms` (client), `StatCard`

Changed:
- `src/components/search/PropertyCard.tsx`: link and heart slot
- the search page, home page and `card-data.ts`: saved state and links
- `src/app/account/saved/page.tsx`
- `src/app/admin/page.tsx`
- `src/components/layout/nav.ts` (Inquiries for listers)
- `src/lib/rate-limit.ts` (three policies)
- `src/lib/session.ts`: `requirePlatformAdmin` helper, if it reads better than
  `requireRole(["platform_admin"])`
- `README.md`

## Implementation requirements

### Data access
- Every public query keeps `status = 'published'` and an explicit column list. Exact coordinates
  are never selected.
- **Writes:**
  - favorites: `insert … on conflict do nothing` and `delete`
  - inquiries: a transaction that locks the property row, re-checks published and not your own,
    counts the last 24 hours, then inserts
  - moderation: `withTransaction`, `select … for update`, a status guard in the `where`, then the
    log insert. Any status race returns `conflict`.
- **Results are typed unions** (`{ ok: true } | { ok: false; reason }`) mapped to user messages in
  the actions. Internals never reach the client.

### Server Actions
- Each one:
  - parses ids with `z.uuid()` and inputs with the shared Zod schemas
  - reads the session through `getCurrentUser` or `requireRole`
  - applies its rate limit
  - returns `ActionState` with preserved values and field errors
- **Inquiry phone:** normalised with `normalizeKenyanPhone`. An invalid phone is a field error
  ("Enter a Kenyan number, e.g. 0712 345 678").
- **Logs:** no personal data. Inquiry and report logs carry ids only.

### UI
- **Detail layout**, design "03 — Property Detail":
  - `PageContainer`, then breadcrumbs (Home / Buy|Rent|Land / County / Town), each linking to
    the matching search
  - an `h1` title, then a row with the `VerifiedBadge` (when verified), "Listed {date}" in
    Nairobi time, Save and Report
  - the gallery
  - then a `lg:grid-cols-[minmax(0,1fr)_25rem]` grid:
    - **left:** Description, "Property details" chips (`rounded-md border border-line bg-white`),
      Amenities with check icons
    - **right:** a sticky (`lg:sticky lg:top-24`) white card with the price (`text-h1`), "Sale
      price" or "Rent per month", a divider, the lister name and badge, the contact block, and
      the inquiry form
  - Similar listings below in the S7 card grid
- **Mobile:**
  - one column; the price and contact card follow the gallery
  - a sticky bottom bar with the price and a "Contact lister" button that jumps to the form
- **Forms:**
  - `Field`, `Input` and `Textarea`
  - inline errors, a focus-first-error hook, the existing success `FormAlert`
  - submit buttons with a spinner while pending
- **Save button:**
  - a 44px round icon button (`Heart`, filled `emerald-600` when saved)
  - `aria-pressed`, labelled "Save listing" or "Remove from saved"
  - on cards it sits top-right, above the stretched link
- **Admin:**
  - tables use `<table>` with a `<caption>` (visually hidden) on desktop, and stacked cards on
    mobile
  - Reject and Take down open an inline reason field (textarea with a counter) before they
    submit
- **Tokens and accessibility:**
  - as S7
  - one `h1` per page
  - focus visible
  - every control at least 44px
  - colour never the only signal (the Unread badge has text)

## Security requirements

- **Public data:**
  - The detail page returns public fields of published rows only.
  - Phones and emails reach the browser only under the contact rule, and only for that viewer.
  - The rule is decided on the server, so the HTML never holds a hidden phone.
- **Server Actions:**
  - check the session; refuse acting on your own listing for inquiries and reports
  - never trust a client-sent owner, status, recipient or verified flag
  - take the recipient from the property row
- **Moderation:**
  - checks `platform_admin` in every action and page (`requireRole`, a 404 otherwise)
  - writes the append-only log in the same transaction as the status change
  - the admin's user id comes from the session, never from the form
- **Rate limits:** inquiries, reports and saves (Upstash in production, memory in development).
- **Inbox:**
  - only shows inquiries for listings the user can manage
  - mark-as-read is scoped the same way, so a forged id marks nothing
- **Text:** messages, report details and reasons are stored as plain text and rendered by React,
  never with `dangerouslySetInnerHTML`.

## Acceptance criteria

1. **Detail:**
   - A published listing opens at `/properties/[slug]` with its gallery, facts, description,
     amenities, lister panel and inquiry form.
   - A draft, in-review, paused, rejected, sold, rented, withdrawn or archived slug returns 404.
   - The page holds no exact coordinates, no owner id, and no unverified lister's phone before an
     inquiry (checked in the HTML).
2. **Gallery:** arrow keys, the previous and next buttons, swipe on touch, and Escape all work;
   the counter is announced; it works at 390px without overflow.
3. **Contact rule:**
   - a verified lister's phone shows to everyone
   - an unverified lister's phone shows only after this user's inquiry, then stays visible on
     later visits
   - another user still doesn't see it
4. **Inquiry:**
   - creates a row with the owner as recipient and the phone in E.164
   - errors keep the typed values
   - your own listing, a 4th inquiry in 24 hours, an exact repeat, and an unpublished listing are
     refused with clear messages
   - signed-out visitors get a sign-in link back to the listing
5. **Inbox:**
   - the lister (and an agency admin for agency listings) sees the inquiry on `/account/inquiries`
   - a stranger sees none
   - Mark as read works and can't touch other people's inquiries
6. **Saved:**
   - save and unsave from a card and from the detail page
   - `/account/saved` shows the saved published listings and their count
   - a paused saved listing disappears from it
   - signed out, the heart leads to sign-in and back to the same page
7. **Reports:** a report is created; a second open report from the same person is refused
   politely; reporting your own listing is refused.
8. **Moderation:**
   - **Approve:** a pending listing (active plan) publishes, appears in search, and logs `approve`
     with the admin id
   - **Approve on an inactive plan:** refused, and the listing stays pending
   - **Reject:** needs a reason; the lister sees it
   - **Take down:** sets `rejected`, resolves its open reports, and logs `take_down` with the
     `report_id`
   - **Dismiss:** marks the report `dismissed`
   - non-admins and billing admins get a 404 on the moderation pages
   - a race (two admins) yields one decision and one log row
9. **Cards** link to the detail page, and their heart works without breaking the link.
10. **Checks:** `typecheck`, `lint`, `test`, `test:integration` and `build` pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (Neon test branch; new suites use unique fixture ids and plan codes)
- `npm run build`
- An Edge (`playwright-core`) walkthrough against a fresh `next start`, at 1280px and 390px:
  - detail page, gallery keyboard and dialog, save and unsave, inquiry send and contact reveal,
    report, inbox, saved page
  - admin approve and reject, and report take down
  - throwaway SAMPLE users and listings on the dev branch, archived afterwards

## Manual test steps (after implementation)

1. Restart `npm run dev`. You need two accounts:
   - your **lister** account, with a plan
   - a **buyer** account: sign up with another email in a private window
   - and a **platform admin**: `ADMIN_CREATE_CONFIRM=yes npm run admin:create -- <your email>`.
     It can be the lister account.
2. As the lister, submit a new listing with photos. It shows **In review**.
3. As the admin, open `/admin`. The **Pending review** count includes it.
   - Open **Listings awaiting moderation**, click **Review**, read the preview, and click
     **Approve**.
   - It leaves the queue and appears on `/properties`.
4. As the buyer, open the listing from search:
   - The gallery opens with View all photos. Arrow keys move through the photos and Escape closes
     the viewer.
   - Tap the heart. Open `/account/saved` and the listing is there.
   - The lister panel shows no phone. Send **Request a viewing** with a phone such as
     `0712 345 678`. A success message appears and the lister's phone is now shown.
   - Send three more. The 4th within a day is refused.
   - Click **Report listing**, choose a reason and send it. Report it again: you're told it's
     already reported.
5. As the lister, open `/account/inquiries`. The buyer's message, phone (+254…) and time appear as
   **Unread**. Click **Mark as read**.
6. As the admin, open `/admin/reports`, then **Take down** the reported listing with a reason:
   - It disappears from search and its detail page returns 404.
   - The lister sees it as **Rejected** with the reason on My listings.
7. Submit another listing and **Reject** it with a reason. The lister sees the reason.
8. Signed out, open a listing and tap the heart. You're sent to sign in, then back to the same
   listing.
