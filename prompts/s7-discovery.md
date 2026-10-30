# S7 — Public discovery and ranking

## Goal

Buyers and tenants can find published listings (plan v2.0 §5, §9 "Public discovery"):

1. A **search page** at `/properties`:
   - the Buy / Rent / Land control, a location search and filters (property type, price range,
     bedrooms, bathrooms, furnished, parking, verified only)
   - removable filter chips, Clear all, a result count, pagination and sorts
   - a mobile filter drawer with Apply and Reset
   - property cards with skeleton, empty and error states
2. **Ranking** (`src/db/queries/ranking.ts`), computed on the server from stored data:
   - **Recommended** (the default sort):
     - verified listers' listings first, then everyone else
     - a score within each tier
     - a daily rotation among similar scores in the verified tier
     - at most 3 listings per lister in the first 20
   - **Newest** and **Price** sorts are strict, with a "Verified listers" strip of up to 3
     matching verified listings above them
   - ranking only reorders matches; it never adds a listing that doesn't match the filters
3. A **disclosure line** under the results and a short `/how-it-works` page explaining
   verification and ranking (plan §5 "Disclosure").
4. A **home page** built from design "01 — Homepage":
   - a hero, the search control, popular locations, and a listings section
   - the listings section shows verified featured listings when any qualify, and otherwise the
     newest listings without the Featured label (plan §5 "Home page")

Public queries return **published listings and public fields only**. Paused, draft and in-review
listings never appear.

**Not in this slice:**
- the listing detail page, gallery, save (heart) button, inquiries and reports (S8). In S7 cards
  are **not links** yet (decision 3).
- maps, PostGIS and location autocomplete (Phase 3)
- view, save and inquiry metrics (plan §5 "Measuring it", later)
- paid verification itself (Phase 2). Until then nobody is verified, so the verified tier, strip
  and featured section stay empty in real data. The code ships now and is tested with verified
  fixtures.

## References read

- `AGENTS.md` §§1–10: §4 (public visibility, trust signals: never fake verification), §6
  (ranking rules), §7 (money, Nairobi time), §10.
- Plan v2.0:
  - §1: Buy / Rent / Land mapping (Buy and Rent filter by listing type, Land by category)
  - §5: search ranking, home page, disclosure
  - §6: only published listings are public; exact location is never returned
  - §9: "Public discovery" bullets
- Slice plan S7 (`~/.claude/plans/above-is-the-scope-immutable-torvalds.md`).
- Designs:
  - `2 - Public Pages/01 — Homepage - Desktop`, `02 — Search Results - Desktop` and
    `06 — Mobile Homepage - 390px`
  - `1 - Design System & Components/Property card - reusable`, `Search control - desktop`,
    `Status badges`
  - The homepage mock overlaps the hero heading and the subtitle; the intended layout separates
    them. The mock's "✓ VERIFIED" pill uses the plan wording "Profile verified" (`VerifiedBadge`).
- Next 16 docs:
  - `03-api-reference/02-components/form.md`: `next/form` does a client-side GET navigation and
    prefetch, and degrades to a plain form without JavaScript
  - `03-file-conventions/page.md`: `searchParams` is a Promise
  - `loading.md`, `error.md`
- The v1.1 reference (`../propertyhub-phase1-final/propertyhub`), consulted only:
  - `src/lib/search-params.ts`: defensive parsing, canonical hrefs, chips, LIKE escaping
  - `src/db/queries/properties.ts`: an explicit public column list
  - `PropertyCard`, `FilterDrawer`, `Pagination`
  - It has no tiers, rotation, caps or verified strip; those are new here.

## Existing code inspected

- `src/db/schema.ts` `properties`:
  - `status`, `listing_type`, `category`, `price_kes` (bigint as number), `rent_period`,
    `bedrooms`, `bathrooms` (numeric), `area_sqm`, `land_size` and unit, `furnished`,
    `parking_spaces`, `amenities[]`, `county`, `town`, `neighbourhood`, `published_at`,
    `owner_user_id`, `agency_id`
  - the public and private coordinates
  - indexes: `properties_public_search_idx`, `properties_published_idx`, trigram GIN on `title`
    and `town`
- `property_images`: `is_cover`, `storage_key`, `alt_text`, `sort_order`.
- The `lister_verified_now(user_id)` SQL function (S2), the single source of the badge.
- `src/db/queries/listings.ts` (`photoSummaries`) and `src/lib/storage` (`publicImageBaseUrl`,
  `FEATURED_PHOTO_COUNT = 5`).
- `ListingImage` (4:3, variant loader, branded fallback), `ListingSummary.listingFacts` and
  `listingLocation`, `format.ts` (`formatKes`, `formatKesCompact`).
- `ui/*`: `VerifiedBadge`, `Badge`, `Chip`, `SegmentedControl`, `Select`, `Input`, `Field`,
  `Skeleton`, `EmptyState`, `IconButton`, `Button`.
- `nav.ts` (`MAIN_NAV`: Explore → `/`, Pricing), `SiteHeader`, `MobileMenu`, `SiteFooter`.
- The current placeholder home page `src/app/page.tsx`.
- `src/lib/search-params.ts` (only `single` and `carriedNext` today).

## Decisions and assumptions

Please check these when approving. **1, 2, 3 and 6 are the ones most worth your eye.**

1. **The Recommended score.** It is computed in SQL; the weights live in
   `src/lib/search/ranking.ts`. Each part is between 0 and 1:

   | Part | Weight | How |
   |---|---|---|
   | Match | 0.35 | With a location query: the best `pg_trgm` `similarity()` against neighbourhood, town, county and title. Otherwise 0 for all, so it doesn't reorder. |
   | Recency | 0.35 | `1 / (1 + days since published / 14)` |
   | Quality | 0.30 | `0.6 × min(photos, 8) / 8 + 0.4 × completeness` |

   **Completeness** is the share filled in of: bathrooms, area or land size, neighbourhood, at
   least one amenity, and a description of 200+ characters. Bedrooms also count for non-land
   listings.

   **Daily rotation.** The verified tier is grouped into score buckets of 0.1. Within a bucket,
   the order is `md5(listing id || Nairobi date)`, so it changes once a day and is stable within a
   day. The unverified tier is ordered by score, then by `published_at` and `id`. The plan rotates
   only the verified tier.
2. **The per-lister cap counts an agency as one lister.** The partition key is
   `coalesce(agency_id, owner_user_id)`. Plan §5 says the cap exists to stop large agencies taking
   every top spot.
   - The cap is applied to the first 20 positions of the Recommended order: a lister's 4th and
     later listings are moved down until the top 20 holds at most 3 from any one lister.
   - Their other listings keep their order after position 20.
   - It runs in SQL with `row_number()` windows over the matching set.
   - Newest and Price sorts are strict, with no cap, as the plan says.
3. **Cards are not links in S7.** The detail page arrives in S8; linking now would create dead
   links (plan §12). S8 wraps the card in a stretched link to `/properties/[slug]` and adds the
   save button. The card's markup is built so that change is one prop.
4. **URL and params.** The page is `/properties`. Parameters:

   | Param | Values |
   |---|---|
   | `mode` | `buy` (default), `rent`, `land` |
   | `q` | location text, ≤ 80 chars |
   | `type` | repeatable: `house`, `apartment`, `land`, `commercial`; hidden in `land` mode |
   | `minPrice`, `maxPrice` | whole shillings, commas allowed |
   | `beds`, `baths` | 1–5, meaning "N or more" |
   | `furnished`, `parking`, `verified` | `1` |
   | `sort` | `recommended`, `newest`, `price_asc`, `price_desc` |
   | `page` | page number |

   Parsing is defensive: unknown or malformed values are dropped, never thrown. If `minPrice >
   maxPrice`, both are dropped and the field shows "Minimum price can't be higher than the
   maximum." The page size is 12, and a page past the end clamps to the last page.
   - **Buy** means `listing_type = sale` (houses, apartments, land and commercial for sale).
   - **Rent** means `listing_type = rent`.
   - **Land** means `category = land` (for sale or rent), per plan §1.
5. **Location search** matches `q` against county, town and neighbourhood with escaped `ILIKE
   %q%`. It also scores trigram similarity (decision 1). The title isn't matched, so "Kilimani"
   doesn't pick up a listing that only mentions Kilimani in its title. There is no autocomplete
   until Phase 3.
6. **One search form, no JavaScript needed.** The results page has a top bar (location, Buy /
   Rent / Land, Update results) and a filter sidebar. Both belong to one `next/form`
   (`id="search-form"`), with the sidebar inputs joined through the HTML `form` attribute, so
   submitting either keeps every filter.
   - **Price** is only in the sidebar (minimum and maximum inputs). The mock's "Any budget" in the
     results top bar is dropped to avoid two price controls.
   - The **home** search control (mode, location, property type, budget) is a small client
     component: its budget presets change between Buy, Rent and Land.
   - **Sort** is a `Select` in the results header that submits the form on change. With
     JavaScript off, a visually hidden "Apply sort" button covers it.
   - **Mobile (< lg):** the sidebar becomes a full-screen drawer behind a "Filters (n)" button,
     with **Apply** (submit) and **Reset** (a link to the current mode with no filters).
7. **The verified strip.** With Newest or Price sorts on page 1, up to 3 matching verified
   listings appear above the results, labelled "Verified listers". They are ordered by the
   Recommended order and cut to 3. They also appear in the main list in their strict position.
   The strip is hidden when there are none (all of Phase 1).
8. **The disclosure line** shows under the results header on every sort: "Verified listers
   appear first. Verification is a paid service that includes an identity and business check.
   How ranking works" (a link to `/how-it-works`). The help page is short and static:
   - what "Profile verified" checks
   - that verification is paid and reviewed
   - how Recommended, Newest and Price work, including the strip, rotation and caps
   - that ranking never adds listings that don't match
   - that the badge isn't a licence or a guarantee about a property

   The header gains "How it works", and "Explore" points to `/properties`.
9. **Home page:**
   - The hero copy comes from the mock. The search control is as decision 6.
   - "Explore popular locations" has four tiles: Nairobi, Kiambu, Mombasa, Nakuru, each linking
     to `/properties?q=<county>`. They use Soft-green and warm placeholder blocks, as in the mock;
     no stock photos.
   - Then one listings section from `homeShowcase()`:
     - **Featured candidates** are verified listers' published listings with at least 5 photos
       and a cover (required fields are already enforced at publish time).
     - Each lister gets at most 2, rotated daily with the same md5 seed, filling up to 6 slots.
     - The remaining slots take the newest published listings, without a Featured label.
     - The heading reads "Verified homes worth a closer look" only when at least one featured
       listing is shown; otherwise it reads "Newest listings".
   - With no published listings, the section is replaced by an `EmptyState` with a "List your
     property" link.
10. **The card** follows "Property card - reusable" and the search mock:
    - a 4:3 cover image (`ListingImage`, `sizes` set for a 1/2/3-column grid), with alt text
      from the cover photo's alt, or "{category} in {town}"
    - `VerifiedBadge` over the image only when `lister_verified_now` is true
    - the price as `text-h3` in the design's large bold; rent shows "/ month", "/ week" or
      "/ year"
    - the title, the location ("Kilimani, Nairobi"), and facts (beds · baths · parking for
      homes, land size for land, area for commercial)
    - a divider, then the lister's identity: the agency name, or the lister's display name
    - no phone numbers or email
    - a "Featured" badge only in the home featured slots
11. **Public data access** lives in `src/db/queries/public-listings.ts`:
    - an explicit column list (no exact coordinates, owner ids or contact details) and
      `status = 'published'` in every query
    - the owner and agency ids are used inside the SQL for the cap but are not returned to the
      page
    - covers come from a subquery on `property_images` (the `is_cover` row)
12. **Caching:** none. Pages are dynamic inside `<Suspense>` (the database and `searchParams`).
    `loading.tsx` shows the skeleton grid, and `error.tsx` shows "We couldn't load properties"
    with Try again (`reset`). No route `runtime` or `dynamic` exports.
13. **No migration expected.** The existing indexes cover the filters. If `EXPLAIN` on the test
    branch shows a sequential scan problem at the seeded scale, it gets reported, not
    pre-optimised.
14. **Metadata:**
    - the title follows the mode: "Properties for sale in Kenya", "Properties for rent in Kenya",
      "Land in Kenya"
    - pages past page 1 or with filters set get `robots: { index: false }`, so search engines
      index only the canonical mode pages

## Files likely to change

New:
- `src/lib/search/params.ts` (pure): `parseSearchParams`, `searchHref`, `activeFilters` (chips),
  `escapeLike`, `MODES`, `SORTS`, `PAGE_SIZE`, plus `params.test.ts`.
- `src/lib/search/ranking.ts` (pure): weights, the bucket size, the cap constants (3 in the
  first 20; 2 per lister and 6 slots on the home page), `nairobiDateSeed(now)`, and
  `ranking.test.ts`.
- `src/db/queries/public-listings.ts`: `publicListingColumns`, the published-only base,
  `filterConditions(filters)`, `searchListings(db, filters, now)` returning
  `{ items, total, page, pageCount, verifiedStrip }`, and `homeShowcase(db, now)`.
- `src/db/queries/ranking.ts`: the Recommended order SQL (score, tiers, rotation, cap) and the
  strict orders.
- `src/db/queries/public-listings.integration.test.ts`.
- `src/app/properties/page.tsx`, `loading.tsx`, `error.tsx`.
- `src/app/how-it-works/page.tsx`.
- `src/components/search/`:
  - `PropertyCard` (and `PropertyCardSkeleton`)
  - `ResultsHeader` (count, sort, chips, Clear all, disclosure)
  - `SearchBar` (results top bar)
  - `FilterPanel` (sidebar fields)
  - `FilterDrawer` (client)
  - `SortSelect` (client)
  - `Pagination`
  - `VerifiedStrip`
  - `HomeSearch` (client)
  - `LocationTiles`

Changed:
- `src/app/page.tsx` (the home page)
- `src/components/layout/nav.ts` (Explore → `/properties`, add How it works), `SiteFooter` links
- `src/lib/search-params.ts`: unchanged, apart from re-exporting nothing new; the new code lives
  in `src/lib/search/`
- `README.md`: the S7 notes

## Implementation requirements

### Search parsing (pure, unit-tested)

- `parseSearchParams(raw)` returns `{ filters, errors }`, and `searchHref(filters)` gives the
  canonical URL: defaults omitted, keys in a stable order, `page` dropped when it is 1.
- `activeFilters(filters)` returns chips `{ id, label, href }`. Each href removes one filter and
  resets the page. Mode isn't a chip (it's the segmented control).
- `escapeLike` escapes `\`, `%` and `_`.

### Queries

- `filterConditions(filters)` builds SQL from parsed filters only. Every value is a bound
  parameter, never interpolated text.
- `searchListings`:
  - one count query
  - one page query: the ordered CTE, `offset/limit`
  - for Newest and Price on page 1, one verified-strip query
  - every query includes `status = 'published'`
- **The Recommended order CTE:**
  1. `matched`: the filtered rows, plus the cover, photo count, verified flag
     (`lister_verified_now(owner_user_id)`), score and lister key
  2. `ordered`: tier, bucket, rotation key, `pos`, and `lr` (`row_number()` per lister key)
  3. `capped`: the top 20 come from rows with `lr <= 3` in `pos` order; everything else follows
     in `pos` order
- `homeShowcase(db, now)` returns `{ featured: Card[]; newest: Card[] }`. The two lists never
  overlap, and together they hold at most 6.
- **Bigints:** prices stay numbers, using the schema's `mode: "number"`.

### UI

- **Layout:** `PageContainer`, then breadcrumb (Home / Buy property), then `h1` (title by mode)
  with the count line ("{n} listings · Browse homes, apartments, land and commercial property"),
  then the search bar card, then the grid `lg:grid-cols-[17.5rem_minmax(0,1fr)]`.
  - **Sidebar:** a white card, `rounded-xl`, `p-6`, with "Filters" `text-h4` and a "Clear all"
    link.
  - **Results column:**
    - "Active filters" chips (`Chip` with ×), the sort select on the right, and the disclosure
      line
    - then the verified strip
    - then the card grid (`sm:grid-cols-2 xl:grid-cols-3`, `gap-6`), then pagination
- **The filter panel** (design "02 — Search Results"):
  - section eyebrows in caption caps, `slate-600`
  - listing type as a `SegmentedControl`: For sale / For rent / Land
  - property type checkboxes (accent `emerald-600`, rows at least 44px)
  - price: two inputs (`inputMode="numeric"`, placeholders "KSh 0" and "No max")
  - bedrooms and bathrooms as segmented pills (Any, 1+, 2+, 3+, 4+)
  - Furnished, Parking and "Verified listers only" checkboxes
  - "Apply filters" as a full-width primary button at the bottom
- **Chips:** `mint-50` with an `emerald-700` label and an × button-link at least 44px tall, with
  the aria-label "Remove filter: {label}".
- **Pagination:** previous / next and up to 5 numbered pages. The current page has
  `aria-current="page"`. Disabled ends are spans, not links.
- **Empty state:** "No properties match these filters" with "Clear filters" and, when
  `verified=1`, "Show all listers". **Error state:** `error.tsx`.
- **The home page** follows the mock and fixes its overlap:
  - the eyebrow "Kenya property marketplace" (`text-label` uppercase, `emerald-700`)
  - `text-display-sm md:text-display` heading, then the subtitle with `mt-4`
  - the hero illustration (kept from S0)
  - the search card overlapping the hero bottom on lg (`-mt-12` with `relative z-10`), and
    stacked on mobile as in "06 — Mobile Homepage"
  - location tiles in a 2-column grid on mobile and 4 on lg
  - the listings section in 1/2/3 columns
- **Tokens and accessibility:**
  - Forest `emerald-600` for primary actions; Soft green for chips, panels and tiles; Charcoal
    `ink` for text; Muted `slate-600`; `line` borders; `line-strong` on controls
  - Poppins at 90% root, the 8pt rhythm, 12px control radius, 1280px content width
  - every control at least 44px
  - one `h1` per page; the results count lives in a `role="status"` region
  - cards are `article`s with an `h3` title

## Security requirements

- Public queries select only public columns and only `published` rows. Exact coordinates,
  owner and agency ids, phones, emails, review fields and pause reasons are never returned.
- All filter values are parsed and bound. `q` is length-capped, LIKE-escaped and bound. The page
  number is capped (≤ 500) so OFFSET stays bounded.
- The verified flag and the ranking come only from `lister_verified_now` and stored rows; a URL
  parameter can only *filter* to verified, never grant it.
- No personal data in logs. The search page writes no logs per request.

## Acceptance criteria

1. **Visibility:** `/properties` lists only published listings. Draft, pending_review, paused,
   rejected, rented, sold, withdrawn and archived listings never appear on it or on the home page.
2. **Buy / Rent / Land** map as decision 4. Each filter narrows the results correctly, and
   min > max shows the error and ignores both.
3. **Chips:** each chip removes exactly its filter, and Clear all keeps only the mode.
   Pagination, the count and clamping all work.
4. **Recommended:**
   - verified listings precede unverified ones
   - within a tier, a better score ranks higher
   - the verified-tier order is stable within a day and changes with the date seed
   - no lister (or agency) holds more than 3 of the first 20, and their other listings still
     appear after position 20
5. **Strict sorts:** Newest and Price ignore tiers. Page 1 shows a strip of at most 3 matching
   verified listings, and none when no verified listing matches.
6. **Never adds:** a verified listing that fails a filter appears in neither the results nor the
   strip.
7. **Home page:**
   - featured holds at most 2 per lister, only verified listers with 5+ photos and a cover, at
     most 6 in all
   - the newest fill the rest with no Featured label
   - the heading reflects which case applies
8. **Public fields only:** no exact coordinates or owner ids in the page's RSC payload (checked
   by an integration test on the returned objects, and by searching the HTML for the seeded exact
   latitude).
9. **Mobile:** at 390px the drawer opens and closes (Escape too), Apply submits, and Reset
   clears. There is no horizontal overflow, and targets are at least 44px.
10. **Checks:** `typecheck`, `lint`, `test`, `test:integration` and `build` pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (Neon test branch)
- `npm run build`
- An Edge (`playwright-core`) walkthrough of the home page, `/properties` with filters, the
  mobile drawer, and the empty and paged states at 1280px and 390px. It runs against throwaway
  published listings created on the dev branch, which are archived afterwards.

## Manual test steps (after implementation)

1. `npm run dev`. As a lister on an active plan (S3–S6), submit two or three listings with photos.
   The admin moderation queue arrives in S8, so approve them on the **dev** branch in the Neon SQL
   editor:
   `update properties set status = 'published', published_at = now(), reviewed_at = now() where status = 'pending_review';`
2. Open `http://localhost:3000/`. The hero, search control, location tiles and "Newest listings"
   appear with your cards.
3. In the home search choose **Rent**, type `Nairobi` and click **Search properties**. You land on
   `/properties?mode=rent&q=Nairobi` with matching rent listings only.
4. On `/properties`:
   - tick **Apartment** and set a minimum price above the maximum, then click Apply. The error
     shows and both prices are ignored.
   - fix the prices and apply. Chips appear; remove one, then **Clear all**.
5. Switch the sort to **Newest**, then **Price: low to high**. The order changes strictly.
6. Shrink the window to 390px. Open **Filters**, change something, **Apply**, reopen it,
   **Reset**. Close it with Escape.
7. Pause one of your listings (or let S9 do it). It disappears from `/properties` and the home
   page on refresh.
8. Open `/how-it-works` from the disclosure link under the results.
