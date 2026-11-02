# UI: Explore (`/properties`) on phones

## Goal

On a phone, show listings on the first screen. Today the first result photo starts ~645px down an
844px iPhone screen, under a stack of controls. Make the controls compact, make Buy / Rent / Land
switch results in one tap, and shorten the filter sheet. Tablet and desktop stay as they are.

## References read

- `AGENTS.md` design rules (six sizes, 44px controls, `control-sm` 32px, radii, tokens)
- `docs/implementation-plan-v2.md` §5 "Disclosure": search results must show "Verified listers
  appear first. Verification is a paid service that includes an identity and business check."
- `prompts/s7-discovery.md` decision 6 (search form works without JavaScript; filter drawer is an
  HTML popover), `prompts/ui-mobile-optimization.md` (phone type scale)

## What was checked (live site, 2026-11-02)

https://verifiedpropertieske.vercel.app/properties?mode=rent and `/properties` at 390×844
(phone emulation) and 1280×800, plus the open filter sheet.

Phone, top to bottom before the first result: header 66px · breadcrumb · 2-line H1 · 2-line
subtitle · search card (search field, Buy/Rent/Land, full-width "Update results") · full-width
"Filters" button · count + "Sort by" row · 3-line ranking disclosure → first photo at ~645px.

Other phone problems:

1. Buy / Rent / Land does nothing until "Update results" is pressed; most people expect one tap.
2. "Filters" sits alone on a full-width row, separate from the search controls.
3. The filter sheet is one long column of 44px checkbox rows (4 types, 3 "More" options); with
   price, bedrooms and bathrooms it needs scrolling before "Apply filters".

Desktop has no blocking problems (noted, not changed: the 176px filter sidebar is tight).

## Decisions

- **Phones = below `md` (< 768px)**, matching where the filter sidebar becomes a drawer.
- **Hide on phones:** the breadcrumb and the subtitle (`hidden md:block`). The H1 stays (SEO,
  page identity); page top padding `pt-4 md:pt-6`.
- **Search card on phones, two rows:**
  1. search field + a 44px square search (submit) button with an icon and `sr-only` "Search";
  2. Buy / Rent / Land on the left, "Filters (n)" button on the right.
  From `md` the card is unchanged (field · segmented · "Update results").
- **One-tap mode:** `SearchForm` gets an opt-in `submitOnChange` list of field names; the results
  `SearchBar` passes `["mode"]`, so changing Buy / Rent / Land submits immediately (phones and
  desktop). The home search does not opt in. Without JavaScript the submit button still works.
- **Filters button moves into the search card** (phones only), opening the same popover
  (`popoverTarget`). `FilterDrawer` loses its own button; its wrapper becomes `max-md:contents` so
  it adds no empty grid row. The active-filter count comes from the page as a prop.
- **Results toolbar on phones:** "Sort by" label `sr-only` below `md` so count and sort sit on one
  short line; sort select width `w-40 md:w-44`.
- **Disclosure:** wording unchanged (plan §5); `text-micro md:text-small` so it takes two short
  lines on a phone.
- **Filter sheet on phones:** "Property type" and "More" checkboxes in a 2-column grid
  (`grid grid-cols-2 gap-x-3 md:grid-cols-1`); rows stay 44px.
- Not changing: results grid, cards, pagination, verified strip, URLs, ranking, filters logic.

Expected first-result top on a 390×844 phone: ~430px (photo visible on the first screen).

## Files likely to change

- `src/app/properties/(search)/page.tsx`: hide breadcrumb/subtitle on phones, top padding, pass
  `activeCount` to `SearchBar`
- `src/components/search/SearchBar.tsx`: phone layout, icon submit, Filters button, `submitOnChange`
- `src/components/search/SearchForm.tsx`: `submitOnChange` prop (form `onChange` →
  `requestSubmit()` when the changed field's name is listed)
- `src/components/search/FilterDrawer.tsx`: remove the mobile trigger, `max-md:contents` wrapper;
  export a small `FiltersButton` (same popover target, label "Filters" + count)
- `src/components/search/ResultsHeader.tsx`: `sr-only` sort label below `md` (via `SortSelect`),
  disclosure size
- `src/components/search/SortSelect.tsx`: label class, width
- `src/components/search/FilterPanel.tsx`: 2-column checkbox grids below `md`
- `src/components/search/SearchPageSkeleton.tsx`: match the new phone layout if it mirrors it

## Implementation requirements

1. `SearchForm`: `submitOnChange?: readonly string[]`; on the form's `change` event, if the target
   is an input/select whose `name` is listed, call `event.currentTarget.requestSubmit()`. Existing
   `onSubmit` canonical-URL behaviour unchanged.
2. `SearchBar({ filters, activeCount })`: form `grid grid-cols-[minmax(0,1fr)_auto] gap-3 p-3`
   below `md`; row 1 field + submit (`size-control`, `Search` icon, `sr-only` "Search",
   `md:hidden`); row 2 `col-span-2 flex items-center justify-between gap-3` with the segmented
   control and `FiltersButton` (`md:hidden`). From `md` the current flex row with "Update results"
   (`hidden md:inline-flex`). Keep one form, one `q` and one `mode` field.
3. `FiltersButton` is `type="button"` with `popoverTarget={FILTERS_PANEL_ID}`, secondary style,
   `h-control`, icon + "Filters" + ` (n)` when n > 0. Remove the old trigger from `FilterDrawer`.
4. Page: `nav[aria-label=Breadcrumb]` and the subtitle `hidden md:block`; `pt-4 md:pt-6`;
   `activeFilters(filters).length` passed to both `SearchBar` and `FilterDrawer`.
5. `SortSelect`: label `max-md:sr-only`; select `w-40 md:w-44`.
6. `RankingDisclosure`: `text-micro md:text-small`, same text and link.
7. `FilterPanel`: property-type and "More" fieldsets wrap their checkboxes in
   `grid grid-cols-2 gap-x-3 md:grid-cols-1`.
8. Every control keeps a visible or `sr-only` accessible name; focus order follows the visual
   order; the popover still opens and closes without JavaScript.

## Security requirements

UI only. No change to query parsing, ranking, visibility or data returned.

## Acceptance criteria

- 390×844 phone, `/properties?mode=rent`: the first result card's top is ≤ 460px; no sideways
  scroll at 360px.
- Tapping Rent / Buy / Land loads that mode's results with no extra tap (URL `mode` updates).
- The icon search button submits the location; "Filters (n)" opens the sheet; Apply / Reset work.
- Filter sheet at 390×844: property types and "More" show in two columns.
- Disclosure text is unchanged and visible above results.
- From 768px up the page looks as before (except mode switching now also submits immediately).
- Home search still needs "Search properties" to submit (no auto-submit there).
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; then a scripted Edge walkthrough
against `npx next start -p 3005` at 360, 390, 768 and 1280px: first-result position, mode tap,
search submit, filter sheet open/apply, overflow, screenshots before/after.

## Manual test steps (after implementation)

1. Restart `npm run dev`, open http://localhost:3000/properties?mode=rent.
2. DevTools device toolbar (Ctrl+Shift+M), iPhone 12 Pro: a listing photo is visible without
   scrolling; breadcrumb and subtitle are gone; the heading stays.
3. Tap "Buy", then "Rent": results change right away.
4. Type "Kilimani", tap the magnifier button: results filter by location.
5. Tap "Filters": types and "More" are in two columns; tick Apartment, "Apply filters"; the
   button now reads "Filters (1)".
6. Switch to 1280px: same layout as before; "Update results" is back; Buy/Rent/Land also switch
   immediately.
7. Home page: changing Buy/Rent/Land does not navigate until "Search properties".
