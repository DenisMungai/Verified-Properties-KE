# UI: design property cards, design detail page, Home in nav

## Goal

1. Bring property cards back to the card in the design folder (`01 — Homepage - Desktop`,
   `02 — Search Results - Desktop`, `Property card - reusable`): wide landscape photo, verified
   pill top-left, heart top-right, **price first**, then title, location, facts, a rule and the
   lister row.
2. Make the listing detail page look like `03 — Property Detail - Desktop`: photo mosaic (one large
   photo plus a 2×2 grid with "View all N photos"), details chips and amenities on the left, a
   wider contact card on the right with a short "Your name / Phone number / Request a viewing" form.
3. Add **Home** (`/`) as the first item in the main nav (desktop bar and mobile drawer).

This change overrides the compact system (`prompts/ui-compact-design-system.md` decisions 10 and 14)
for cards and the detail page only. Colour tokens, the six font sizes, header, search toolbar and
filters stay as they are.

## References read

- `AGENTS.md` (design rules, wording rule "Profile verified", contact rule)
- Design PNGs: `2 - Public Pages/01`, `02`, `03`, `06 — Mobile Homepage`;
  `1 - Design System & Components/Property card - reusable`
- `prompts/ui-compact-design-system.md` (decisions 10, 14)
- Pre-compact card at `afc83f4^:src/components/search/PropertyCard.tsx` (price-first layout)

## Existing code inspected

- `src/components/search/PropertyCard.tsx` (`PropertyCard`, `CARD_GRID`, `CARD_IMAGE_SIZES`, skeletons)
- `src/components/search/CardRail.tsx` (Similar listings rail, `w-64` items)
- `src/components/search/VerifiedStrip.tsx`, `src/app/page.tsx`, `src/app/properties/(search)/page.tsx`,
  `src/app/account/saved/page.tsx` (all use `CARD_GRID`)
- `src/lib/search/ranking.ts` (`HOME_SLOTS = 8`)
- `src/app/properties/[slug]/page.tsx`, `src/components/listing/Gallery.tsx`, `FactsList.tsx`,
  `ListerPanel.tsx`, `InquiryForm.tsx`, `src/lib/validation/engagement.ts`
- `src/components/listings/ListingImage.tsx` (4:3 frame, overridable via `className`)
- `src/components/ui/Badge.tsx` (`VerifiedBadge` → "Profile verified")
- `src/components/layout/nav.ts`, `SiteHeader.tsx`, `MobileMenu.tsx`, `NavLink.tsx`

## Decisions and assumptions

1. **Card photo ratio 16:9.** The mocks are ~2:1 to 2.3:1; 16:9 keeps that wide look while
   cropping less of real (mostly 4:3) photos. Change one class if you want a strict 2:1.
2. **Grid 1 / 2 / 3 columns** (`<640` / `≥640` / `≥1280px`), the design's three-across. The wide
   card with a large price doesn't fit two-up on a 390px phone, so phones get one column.
3. **`HOME_SLOTS` 8 → 6** so the home grid fills two rows of three (and three rows of two) with no
   orphan row. `HOME_PER_LISTER` stays 2. Integration tests already assert against the constant.
4. **Wording stays honest.** The design's "✓ VERIFIED", "✓ Verified listing" and "✓ Verified
   property professional" all render through `VerifiedBadge` ("Profile verified"), restyled to match,
   and only when the server says `verified`. The card footer shows the lister's name, as now (the
   design's "Verified property professional" footer would claim verification for unverified listers).
   "Reviewed listing" is not shown (verified listers skip moderation, so it would be untrue).
5. **No invented copy.** The design's tagline "A home designed for everyday living" has no data
   behind it; the heading stays "About this property". "Updated 3 days ago" stays "Listed {date}".
6. **Inquiry form looks like the design without changing the contract.** Name and phone are visible
   with "Request a viewing". Email and message move into a closed `<details>` ("Add an email or a
   message"), with the message still prefilled with `DEFAULT_INQUIRY_MESSAGE`. The `<details>` opens
   by itself when either field has an error. `sendInquiryAction` and `inquirySchema` are unchanged.
   Signed-out visitors still see "Sign in to contact this lister" (inquiries need a signed-in user).
7. **Gallery**: mosaic from `lg` up; below `lg` the current carousel (swipe, arrows, counter,
   thumbnail row) stays as it is. Both open the same full-screen `<dialog>` viewer.
8. The detail page keeps the save heart beside the H1 and the report link (not in the mock, but
   removing them would remove features). The phone bottom bar stays.

## Files likely to change

- `src/components/search/PropertyCard.tsx`
- `src/components/search/CardRail.tsx` (item width only)
- `src/lib/search/ranking.ts` (`HOME_SLOTS`)
- `src/app/page.tsx` (skeleton count only, if it hard-codes 4)
- `src/app/properties/[slug]/page.tsx`
- `src/components/listing/Gallery.tsx`
- `src/components/listing/FactsList.tsx`
- `src/components/listing/ListerPanel.tsx`
- `src/components/listing/InquiryForm.tsx`
- `src/components/layout/nav.ts`
- `AGENTS.md` (design-rules bullets for cards / grid)

## Implementation requirements

### 1. Property card (`PropertyCard.tsx`)

Layout, top to bottom:

- `<article>`: `relative flex w-full flex-col overflow-hidden rounded-xl border border-line bg-white
  transition-shadow duration-200 hover:shadow-sm` + the existing `has-[h3_a:focus-visible]` outline.
- Photo: `ListingImage` with `className="aspect-video"` (16:9). No bottom border.
- Top-left (`absolute left-3 top-3 flex flex-wrap gap-1.5`): `VerifiedBadge` styled as the design's
  white chip: `rounded bg-white px-2.5 py-1 uppercase tracking-wide text-emerald-700`; `Featured`
  badge in the same white chip with `text-ink`.
- Top-right: `SaveButton size="sm"` at `absolute right-3 top-3` (32px circle, 44px hit area).
- Body `flex flex-1 flex-col p-4`:
  - Price: `tabular text-title font-bold text-ink`, rent suffix inline in the same weight
    ("KSh 95,000 / month", as in the mock).
  - Title `h3`: `mt-1 line-clamp-2 text-small font-medium text-ink`, stretched link as now.
  - Location: `mt-1 truncate text-small text-slate-600` (no uppercase).
  - Facts: `mt-2 truncate text-micro text-slate-600`, joined with ` · `.
  - Lister row: `mt-auto pt-3` wrapper, inner `border-t border-line pt-3 text-micro text-slate-700`,
    6px ink dot, sr-only "Listed by ".
- `CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3"`.
- `CARD_IMAGE_SIZES = "(min-width: 1280px) 440px, (min-width: 640px) 50vw, 100vw"`.
- Skeletons match: `aspect-video` block, then price / title / location / facts bars, `p-4`,
  `rounded-xl`. `PropertyGridSkeleton` default `count` 6.
- Update the doc comment (design card, price first).

### 2. Grids and rails

- `HOME_SLOTS = 6` in `src/lib/search/ranking.ts`; home skeleton shows 3 cards.
- `CardRail`: item width `w-72 sm:w-80` instead of `w-64`; Similar listings passes
  `sizes="320px"`.
- Search, saved and verified strip keep using `CARD_GRID` (no other change).

### 3. Detail page header (`[slug]/page.tsx`)

- Breadcrumb unchanged. H1 `text-display-sm` with the heart on the right, as now.
- Meta row: `VerifiedBadge` as the design's mint pill (`rounded-full bg-mint-50 px-3 py-1.5`),
  then a muted `text-small text-slate-600` line: location · "Listed {date}". Drop the `MapPin` icon
  (design has none).
- Spacing: header `gap-3`; page `gap-6 lg:gap-10`.

### 4. Gallery (`Gallery.tsx`)

From `lg` up, replace the carousel with a mosaic:

- `grid h-[27rem] gap-4 grid-cols-[minmax(0,3fr)_minmax(0,1fr)_minmax(0,1fr)] grid-rows-2`.
- Photo 1 spans `row-span-2` in column 1. Photos 2–5 fill columns 2–3:
  - 1 extra photo: `col-span-2 row-span-2`; 2 extra: each `col-span-2`; 3 extra: first two single,
    third `col-span-2`; 4 extra: 2×2.
  - With only 1 photo the main photo spans all three columns.
- Each tile is a `<button>` (`rounded-xl overflow-hidden`, focus ring) opening the full-screen viewer
  at that photo; `ListingImage` with `className="aspect-auto h-full"`. Tile `aria-label`
  "Open photo i of N full screen: alt".
- On the last tile, when N > 1: a white `rounded-lg bg-white px-4 py-2 text-small font-medium
  text-ink` button "View all N photos", bottom-right `right-4 bottom-4`, that opens the viewer at
  photo 1. It is its own button, not nested in the tile button (siblings in a `relative` wrapper).
- Below `lg`: render the existing carousel unchanged (`lg:hidden`); mosaic is `hidden lg:grid`.
  Only one live region / index state is shared.
- Zero photos: the existing placeholder.
- Preload only photo 1 in each layout (`preload` on the mosaic main photo; the carousel keeps its
  current rule). `sizes`: main `(min-width: 1024px) 60vw, 100vw`; tiles `(min-width: 1024px) 20vw`.

### 5. Content column

- Grid `lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px] lg:gap-16`; left
  column `max-w-3xl`.
- "About this property" `text-title`; description `text-body text-slate-600` (via `Description`, as now).
- `FactsList`: eyebrow "Property details" as now; chips `grid grid-cols-2 gap-3 sm:grid-cols-3`,
  each `rounded-lg border border-line bg-white px-3 py-2.5 text-small text-ink`.
- Amenities: heading `text-title`; inline list `flex flex-wrap gap-x-3 gap-y-1 text-small
  text-slate-600`, check icon `size-3.5 text-slate-600` (the design's grey ✓).
- Report link / form unchanged below a `border-t`.

### 6. Contact card (`ListerPanel.tsx`)

- Card `rounded-xl border border-line bg-white p-6`, sticky as now.
- Price block unchanged in content (`text-display-sm`, rent suffix, "Sale price · Ask about viewing
  availability" in `text-micro`), separated by `border-b`.
- Lister: name `text-title`; when verified, `VerifiedBadge` rendered as plain green text (no pill:
  `bg-transparent px-0 py-0 text-emerald-700`); otherwise the lister type, as now. Contact details
  and hidden-contact copy unchanged.

### 7. Inquiry form (`InquiryForm.tsx`)

- Visible: "Your name" (`placeholder="Full name"`), "Phone number" (`placeholder="+254 7xx xxx xxx"`,
  drop the hint), `Button size="lg"` "Request a viewing", note "Your details are shared only with
  this lister."
- Inputs use the design's filled look: `bg-canvas` (or the existing muted surface token) with the
  `line-strong` border kept for 3:1 contrast.
- `<details>` between phone and the button: summary "Add an email or a message"
  (`text-small font-medium text-emerald-700`, `min-h-control`), containing the existing Email and
  Message fields (message prefilled). `open` when `state.fieldErrors?.email || state.fieldErrors?.message`.
- Same field names, action and validation; no server change.

### 8. Nav (`nav.ts`)

- `MAIN_NAV = [{ href: "/", label: "Home" }, { href: "/properties", label: "Explore" }, …]`.
  `NavLink` is exact by default, so Home is only active on `/`. The mobile drawer reads the same list.

### 9. AGENTS.md design rules

Replace the card/grid wording with: cards `rounded-xl`, 16:9 photo, price first, `p-4`;
`CARD_GRID` 1 / 2 / 3 columns; detail page follows `03 — Property Detail` (mosaic gallery from `lg`).

## Security requirements

- No change to what data reaches the browser: cards still get `PropertyCardData` (no storage key),
  the detail page still applies the contact rule on the server.
- Verified styling only renders when the server-derived `verified` is true; the text is always
  "Profile verified".
- The inquiry form posts the same fields to the same Server Action; validation stays server-side.

## Acceptance criteria

- Home, search, saved and similar listings show the design card: wide photo, white "PROFILE
  VERIFIED" chip top-left (verified listers only), heart top-right, bold price first, title,
  location, facts, rule, lister name. Card bottoms align within a row.
- Grids: 1 column under 640px, 2 from 640px, 3 from 1280px. Home shows up to 6 listings.
- Detail page on desktop: breadcrumb, H1, mint "Profile verified" pill + location · listed date,
  photo mosaic with "View all N photos" on the last tile, left details/amenities, right contact card
  with name/phone/Request a viewing. Each tile and the "View all" button open the full-screen viewer
  at the right photo; Escape closes it.
- Detail page under 1024px: carousel with swipe/arrows/counter/thumbnails as before; phone bar stays.
- Listings with 0, 1, 2, 3, 4 and 5+ photos all lay out without gaps.
- Inquiry: sending with only name + phone works; an invalid email opens the details and shows the error.
- "Home" is first in the desktop nav and mobile drawer, highlighted only on `/`.
- No horizontal overflow at 375 / 768 / 1280 / 1920px.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (shared components and a ranking constant changed)
- `npm run test:integration` if `TEST_DATABASE_URL` is set (HOME_SLOTS assertions)

## Manual test steps (after implementation)

1. `npm run dev`, open `http://localhost:3000/`.
2. Header: Home, Explore, How it works, Pricing; Home is green on `/`, not on `/properties`.
   Narrow the window below 768px, open the menu: Home is first.
3. Home listings: three cards per row on a wide screen, price above title, verified chip only on
   verified listers' cards, heart top-right saves (signed in) or goes to sign-in (signed out).
4. `/properties`: same cards, three across beside the filters at ≥1280px, two at tablet width, one
   on a phone width.
5. Open a listing with 5+ photos: mosaic, "View all N photos" opens the viewer at photo 1; clicking
   tile 3 opens photo 3; arrows and Escape work. Repeat with listings of 1–4 photos.
6. Narrow below 1024px: the carousel with thumbnails returns; bottom price bar shows.
7. Signed in as a buyer on someone else's listing: enter name + phone, "Request a viewing" → success
   and contact details appear if the rule allows. Open "Add an email or a message", type a bad email,
   submit → the section stays open with the error.
8. Signed out: the contact card shows "Sign in to contact this lister".
9. Similar listings rail at the bottom scrolls with the arrow buttons and shows the new card.
