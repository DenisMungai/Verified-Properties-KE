# S14 — Home featured sections and the verification help page

Third slice of Phase 2 (plan v2.0 §5 and §10). It follows S13 (verification lifecycle). Messaging
is S15, notifications S16, the Phase 2 exit S17.

## Goal

S7 already built the home listings section to the §5 rules: verified listers only, at least 5
photos and a cover, at most 2 per lister, a daily rotation, and a fallback to the newest listings
without the Featured label. S7 also added the search disclosure line and `/how-it-works`. S14
finishes the §5 and §10 home and help items:

1. **"Featured in Nairobi" (your choice).** A second home section with 4 cards. It shows only
   verified listers' Nairobi listings, under the same quality bar, cap and rotation. When those
   run out, it falls back to the newest Nairobi listings without the label. No card appears in
   both sections.
2. **Help page: checks and costs.** `/how-it-works` explains:
   - which documents the review checks, for each kind of lister;
   - how long a review takes;
   - what verification costs, with the price read from the `plans` table;
   - what happens on rejection, lapse and expiry;
   - how featured placement works.
3. **Pricing page.** The verification add-on card stops saying "Coming soon". It shows the live
   price and a "Get verified" link.

Phase 2 exit criterion covered here: a verified lister "moves to the top of search **and onto the
home page**". That already works for the main section; S14 adds the county section and the
disclosure that goes with it.

## References read

- `AGENTS.md`
- `docs/implementation-plan-v2.md`:
  - §4: the paid verification rules (paying starts a review, the 12-month review, suspension at
    any time, the rejection credit) and the lapse table (3-day grace; the badge returns on renewal
    if the review hasn't expired)
  - §5: home page (featured sections such as "Featured in Nairobi", the quality bar, 2 per lister
    per section, daily rotation, unlabelled fallback) and disclosure (the line in search, the help
    page, the "Profile verified" wording)
  - §10: home page featured sections; the help page on what verification checks and costs
- `prompts/s7-discovery.md` decisions 8 (disclosure) and 9 (home page)
- `prompts/s12-verification.md` (documents per lister type, the 2-working-day target, the
  rejection credit to the listing plan), `prompts/s13-verification-lifecycle.md` (re-review is
  included in the monthly fee, retention periods)
- Design `2 - Public Pages/01 — Homepage - Desktop` and `06 — Mobile Homepage - 390px`. Only one
  listings section is drawn ("Verified homes worth a closer look"); the new section copies its
  header pattern and card grid.
- `prompts/ui-compact-design-system.md`, `prompts/ui-mobile-optimization.md`

## Existing code inspected

- `src/app/page.tsx`: `HomeListings` calls `homeShowcase()` inside `<Suspense>` after
  `connection()`. Featured cards get `featured`, newest cards don't. The heading switches between
  "Verified homes worth a closer look" and "Newest listings".
- `src/db/queries/public-listings.ts`:
  - `homeShowcase(db, now)` builds a `candidates` CTE (`verified`, `photo_count >=
    FEATURED_MIN_PHOTOS`, `"coverKey" is not null`) with `row_number() over (partition by
    lister_key order by rotationKey(seed))`, keeps `lr <= HOME_PER_LISTER` and takes
    `limit HOME_SLOTS`. The newest are queried in parallel and deduped in JS.
  - `matchedSql`, `publishedOnly`, `cards()`/`toCard` (public columns only),
    `lister_key = coalesce(agency_id, owner_user_id)`, and `verified` from
    `lister_verified_now()`.
- `src/lib/search/ranking.ts`: `HOME_SLOTS = 8`, `HOME_PER_LISTER = 2`, `FEATURED_MIN_PHOTOS`
  (= `FEATURED_PHOTO_COUNT` 5) and `nairobiDateSeed`.
- `src/db/queries/public-listings.integration.test.ts`: two `homeShowcase` cases, using the
  `insertLister({ verified })` and `insertListing({ owner, photos, ageDays })` helpers.
- `src/components/search/PropertyCard.tsx`: `featured` shows the "Featured" chip;
  `HOME_CARD_GRID` is 1 / 2 / 4 columns.
- `src/components/search/LocationTiles.tsx` and `searchHref({ q })` from
  `src/lib/search/params.ts`.
- `src/components/search/ResultsHeader.tsx`: `RankingDisclosure` already uses the §5 wording, and
  `HOW_RANKING_WORKS_HREF = "/how-it-works#ranking"`.
- `src/app/how-it-works/page.tsx`: static. Sections `#verification`, `#paid`, `#ranking` and
  `#limits`; it uses `LISTER_CAP`, `CAP_WINDOW` and `VERIFIED_STRIP_SIZE`.
- `src/app/pricing/page.tsx`: listing plans come from `getActivePlans(db, "listing")`. The
  verification card is static, with a "Coming soon" badge.
- `src/db/queries/billing.ts`: `getActivePlans(db, kind)`.
- `src/lib/verification/rules.ts`: `DOCUMENT_LABELS`, `requiredDocumentTypes`,
  `REVIEW_TARGET_WORKING_DAYS`, `REVIEW_VALID_MONTHS`.
- `src/lib/verification/retention.ts`: `RETENTION_DAYS_AFTER_END`,
  `RETENTION_DAYS_AFTER_REJECTION`, `RETENTION_MONTHS_AFTER_SUSPENSION`.
- `src/lib/billing/constants.ts`: `BILLING_PERIOD_DAYS`, `GRACE_DAYS`.
- `src/lib/verification/app-deps.ts`: `VERIFICATION_PATH`. `src/lib/safe-redirect.ts`:
  `signInPath`.
- `src/db/seed/sample-data.ts`: sample listings are mostly in Nairobi, and two sample listers are
  verified.

## Decisions and assumptions

1. **Section order and dedupe.** The main section ("Verified homes worth a closer look", 8 slots,
   site-wide) is chosen first and keeps its place under the location tiles, as in the design.
   "Featured in Nairobi" follows it and excludes every listing the main section shows, both
   featured and newest. The two picks run one after the other (the second needs the first's ids),
   inside the existing single `<Suspense>`.
2. **County section rules.** The county must equal `"Nairobi"`, compared case-insensitively. The
   section has 4 slots (`HOME_COUNTY_SLOTS`, one row of the 4-column grid) and the same quality
   bar. The cap of 2 per lister applies **within the section**, as §5 says ("in each section"),
   and the section uses the same daily seed as the main one. Its fallback is the newest Nairobi
   listings not already shown, without the Featured label.
3. **County section copy.**
   - With at least one featured card, the heading is "Featured in Nairobi". The subline is
     "Featured listings come from verified listers, a paid service." plus a "How it works" link.
   - With none, the heading is "Newest in Nairobi", with no subline about payment.
   - The right-hand link reads "See all in Nairobi" and goes to `searchHref({ q: "Nairobi" })`.
   - With no Nairobi listings left to show, the section is not rendered at all.
4. **Constants.** `HOME_COUNTY = "Nairobi"` and `HOME_COUNTY_SLOTS = 4` go in
   `src/lib/search/ranking.ts`, next to the other home constants. Changing the county later is a
   one-line change; there's no admin setting.
5. **Query shape.** Generalise `homeShowcase`'s internals into one private builder,
   `showcaseSection(db, { where, slots, excludeIds, seed, now })`, that returns
   `{ featured, newest }`. Export `homeSections(db, now)`, returning `{ main, county }`, each a
   `HomeShowcase`. `homeShowcase` stays as a thin wrapper (`main` only), so the seed test and
   existing tests keep working; nothing else calls it. Excluded ids are bound as a parameter
   (`id <> all(${ids}::uuid[])`), never interpolated. The output stays `cardSelect` / `toCard`,
   with no new columns.
6. **Disclosure anchors.** The home "How it works" links (in both sections) point to
   `/how-it-works#featured`. Search keeps `#ranking`. Existing anchors stay, so old links keep
   working.
7. **Help page content** (`/how-it-works`, still one `article` at `width="text"`):
   - The `#verification` section gains a "What we check" list built from `DOCUMENT_LABELS`. It
     shows the documents each lister type sends, the same rule as `requiredDocumentTypes`:
     everyone sends an ID; agents add an EARB practising certificate; developers and agency
     members add business registration. It also covers the review time ("usually within
     `REVIEW_TARGET_WORKING_DAYS` working days"), and the fact that documents are stored
     privately, seen only by our review team, and deleted on a schedule (it quotes the retention
     constants).
   - The `#paid` section becomes "What verification costs". It shows the active verification
     plan's price per `BILLING_PERIOD_DAYS` days, paid with M-Pesa on top of a listing plan. The
     price is read at request time from `getActivePlans(db, "verification")`, inside
     `<Suspense>` with a one-line skeleton. With no active verification plan, it says "Pricing
     will be announced soon" and states no number. It keeps the existing rules (paying starts a
     review; the badge needs both plans) and adds:
     - rejection: "the first month's fee is credited to your listing plan";
     - lapse: `GRACE_DAYS` days of grace, then the badge, ranking boost, featured placement and
       public phone number go; they return on renewal while the review is still valid;
     - the review lasts `REVIEW_VALID_MONTHS` months; re-review is included in the monthly fee.
   - A new `#featured` section, "Featured on the home page", sits after `#ranking`. It covers:
     - only verified listers are featured;
     - the quality bar (at least `FEATURED_MIN_PHOTOS` photos, a cover photo, a complete listing);
     - at most `HOME_PER_LISTER` listings per lister in each section, rotated daily;
     - featured cards carry a "Featured" label, and other cards on the home page are simply the
       newest listings.
   - `#limits` is unchanged.
   - The final CTA row keeps "Browse properties" and adds a secondary "Get verified" link. It
     goes to `VERIFICATION_PATH` for signed-in users with a verified email, and otherwise to
     `signInPath(VERIFICATION_PATH)`, the same as the pricing CTAs. The session is read inside
     `<Suspense>`.
   - Metadata description: "What the Profile verified badge checks, what it costs, and how search
     and the home page are ordered."
8. **Pricing page verification card.** Remove the "Coming soon" badge. Inside `<Suspense>`, read
   the active verification plan and show its price with `formatKes`, "per 30 days" (using
   `BILLING_PERIOD_DAYS`), and the existing explanation. Add a "Get verified" link (secondary
   button, same href rule as decision 7) and a "What we check" text link to
   `/how-it-works#verification`. With no active verification plan, the card shows the
   explanation only, with no price and no CTA.
9. **The wording rule holds everywhere:** "Profile verified" and "verified listers". Nothing says
   or suggests a licence, a guarantee or a legal check.
10. **Out of scope:** a "Verified agents" lister row, public lister profiles, a lister filter in
    search, admin-configurable sections, and any ranking change for search.

## Files likely to change

- `src/lib/search/ranking.ts` — `HOME_COUNTY`, `HOME_COUNTY_SLOTS`
- `src/db/queries/public-listings.ts` — `showcaseSection`, `homeSections`; `homeShowcase` becomes
  a wrapper
- `src/db/queries/public-listings.integration.test.ts` — county section cases
- `src/app/page.tsx` — render both sections from `homeSections`; extract a small
  `ShowcaseSection` presentational component (in `src/components/search/`) so the two sections
  share the header and grid markup
- `src/components/search/ResultsHeader.tsx` — export `HOW_FEATURED_WORKS_HREF`
- `src/app/how-it-works/page.tsx` — the content in decision 7; small server sub-components for
  the price and the CTA
- `src/app/pricing/page.tsx` — the verification card in decision 8
- possibly `src/components/billing/plan-copy.ts` — a shared "per 30 days" price line, if one
  isn't already there

No schema change and no migration.

## Implementation requirements

- **Home**
  - `HomeListings` awaits `connection()` once, then `homeSections(getDb())`. One
    `saveContextFor` call covers every card id from both sections.
  - The empty state (no published listings at all) is unchanged.
  - `ShowcaseSection` takes the heading, an optional subline, the link (`href`, `label`), the
    featured cards, the newest cards, the save context, and an `id` for `aria-labelledby`. It
    renders the same markup as today's section: `text-title` heading, `text-small text-slate-600`
    subline, `HOME_CARD_GRID`, `HOME_CARD_IMAGE_SIZES`.
  - The sections sit inside the `PageContainer`'s `gap-16` flow, each in a `<section
    aria-labelledby>`.
  - The skeleton shows two blocks: 8 cards, then 4.
- **Query**
  - `showcaseSection` reuses `matchedSql(where, null, now)` and `rotationKey(seed)`. The featured
    and newest queries run in parallel, as today.
  - The newest list excludes the featured ids and `excludeIds`. Slots that featured doesn't use
    go to newest.
  - The county `where` is `and(publishedOnly, sql\`lower(${p.county}) = lower(${HOME_COUNTY})\`)`.
- **Help and pricing**
  - Server components only. Lists use the existing `text-body` / `text-small` tokens; there are
    no new type sizes.
  - Prices go through `formatKes`. Every number in the copy comes from the named constants, never
    a literal.

## Security requirements

- Public queries still return only `PublicListingCard` columns through `toCard`. Featured status
  comes only from `lister_verified_now()` in SQL, never from the request.
- `excludeIds` are server-produced UUIDs, bound as a parameter.
- The help and pricing pages read only the active plan's public fields (name, price). No lister
  data or documents are read on either page.
- The "Get verified" CTA is a plain link. Access to `/account/verification` is still enforced
  there by `requireLister`.

## Acceptance criteria

1. In the county section:
   - only Nairobi listings appear;
   - featured cards are verified, with ≥ 5 photos and a cover, and at most 2 per lister;
   - no card appears in both sections;
   - the rest of the 4 slots are the newest Nairobi listings, without the Featured label.
2. With no verified Nairobi listings left after the main section, the county section reads
   "Newest in Nairobi" with no Featured labels. With no Nairobi listings left at all, it isn't
   rendered.
3. A verified lister whose verification lapses past grace (or whose review expires) drops out of
   featured in both sections on the next request. Nothing is cached.
4. The main section's behaviour and existing tests are unchanged, except that its link now points
   to `#featured`.
5. `/how-it-works`:
   - shows the documents per lister type, the 2-working-day target and the retention periods;
   - shows the live verification price, or "Pricing will be announced soon";
   - explains the rejection credit, grace and lapse, and the 12 months with re-review included;
   - has a `#featured` section;
   - has a "Get verified" CTA with the correct href when signed out and when signed in.
6. `/pricing`: there is no "Coming soon" badge. The verification card shows the live price, "per
   30 days" and the "Get verified" and "What we check" links.
7. Every page renders at 390px with no horizontal overflow, with 44px targets for links styled as
   buttons. Under Cache Components, the build reports no "uncached data outside Suspense" errors.
8. No copy implies a licence or a guarantee.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (Neon test branch). New cases in
  `public-listings.integration.test.ts`:
  - county only;
  - no overlap with main;
  - 2 per lister within the county section;
  - fallback unlabelled;
  - an empty county gives an empty section;
  - a lister without a verified status is never featured.
- `npm run build`
- An Edge (`playwright-core`) walkthrough of `/`, `/how-it-works` and `/pricing` at 1280px and
  390px against the dev database with sample data: screenshots, an overflow check, and anchor
  links.

## Manual test steps (after implementation)

1. `npm run dev`
2. If the dev branch has no sample data, run `npm run db:seed -- --dry-run`, then
   `SEED_CONFIRM=<endpoint> npm run db:seed`.
3. Open `http://localhost:3000/`:
   - Below "Explore popular locations" is "Verified homes worth a closer look" (featured cards
     carry Verified and Featured), then "Featured in Nairobi" or "Newest in Nairobi".
   - No card appears twice.
   - "See all in Nairobi" opens `/properties?q=Nairobi`.
4. In each section's subline, click "How it works". You land on the "Featured on the home page"
   section.
5. On `/how-it-works`, check the documents list, the review time, the verification price (it
   matches the active verification plan in `/admin/billing`), the rejection, grace and re-review
   text, and the "Get verified" CTA (signed out it goes to sign-in, then to the verification
   page).
6. On `/pricing`, the verification card shows the price, "per 30 days" and "Get verified".
7. Resize to 390px (DevTools): there's no horizontal scroll, and the sections stack to one column.
8. Optional lapse check: as an admin, suspend one sample verified lister in
   `/admin/verification`. Reload `/`; their listings lose the Featured and Verified labels and
   drop to the newest fallback.
