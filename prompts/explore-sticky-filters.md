# Explore: filters stay in reach while scrolling

## Goal

On Explore (`/properties`), the filters float with the page instead of scrolling away:

1. **Desktop (md and up):** the Filters sidebar stays pinned below the header while the results
   scroll, like the account sidebar does.
2. **Phones (below md):** a floating "Filters (n)" button appears at the bottom of the screen once
   the search card has scrolled out of view, and opens the same filter sheet.

**Out of scope:** changing the filters themselves, the search card, sorting or the results grid.

## References read

- `AGENTS.md` §1 design rules (44px targets, no shadows except property-card hover, `rounded-full`
  pills, `data-mobile-bar` for fixed bottom bars, six type sizes)
- `prompts/s7-discovery.md` decision 6 (sidebar from md, drawer below), `prompts/ui-explore-mobile.md`
- Memory: the owner's phone has no Popover API; the drawer already has a `data-open` fallback, and
  any new opener must use it too

## Existing code inspected

- `src/app/properties/(search)/page.tsx`: grid `md:grid-cols-[176px_minmax(0,1fr)]`; the first
  column is `FilterDrawer`
- `src/components/search/FilterDrawer.tsx`: the wrapper `div.max-md:contents.md:self-start` holds
  the `aside` with `md:sticky md:top-[82px]`. **Bug:** sticky is on the aside, whose parent (the
  wrapper) is exactly as tall as the aside, so it has no room to stick and scrolls away.
  `FiltersButton` opens the drawer (popover, or `data-open` without the Popover API)
- `src/components/search/SearchBar.tsx`: the phone "Filters (n)" button sits in the search card
- `src/app/account/layout.tsx`: the account sidebar's working pattern
  (`lg:sticky lg:top-[82px] lg:max-h-[calc(100dvh-98px)] lg:self-start lg:overflow-y-auto`)
- `src/app/globals.css:212` `body:has([data-mobile-bar])` bottom padding

## Decisions and assumptions

1. **Desktop fix:** move `md:sticky md:top-[82px]` from the `aside` to its wrapper (the grid item,
   already `md:self-start`), and cap it at the viewport: `md:max-h-[calc(100dvh-98px)]` with
   `md:overflow-y-auto` and `overscroll-contain`, so a filter list taller than the screen (Land
   mode, short laptop screens) still scrolls to "Apply filters". A small `md:-m-1 md:p-1`
   keeps focus outlines from being clipped by the scroll box, as in the account layout. 82px = the
   66px sticky header + 16px gap.
2. **Phone floating button:** a new client component `FloatingFiltersButton` renders a pill
   ("Filters" or "Filters (n)", the lucide sliders icon) fixed at the bottom centre
   (`bottom-4`, safe-area aware), `md:hidden`. It shows only while the search card is out of view
   (IntersectionObserver on the search form), fades in/out, and is `hidden` (not just transparent)
   when not shown so it never takes focus or taps invisibly. It opens the drawer exactly like
   `FiltersButton` (popover target, plus the `data-open` fallback).
3. **Look:** primary emerald button styles (`buttonClasses()`), `rounded-full`, `h-control` 44px,
   `px-5`; no drop shadow (design rule), separated from the page by its solid fill; `z-30`, below the
   header (z-40) and the open drawer (z-50).
4. **No overlap with the results:** while it shows it doesn't cover anything that needs a tap at
   the very bottom; the page already ends with pagination and the footer, and the button is small
   and centred. It does not use `data-mobile-bar` (that adds permanent padding for full-width bars).
5. **Reduced motion:** the fade is skipped under `prefers-reduced-motion`.
6. **Without JavaScript** the button simply never appears; the in-card Filters button still works.

## Files likely to change

- `src/components/search/FilterDrawer.tsx` (sticky on the wrapper; export the open helper)
- new `src/components/search/FloatingFiltersButton.tsx`
- `src/app/properties/(search)/page.tsx` (render the floating button with the active count)
- `e2e/visitor.spec.ts` (sidebar stays visible after scrolling on desktop; floating button opens
  the drawer on mobile)

## Implementation requirements

1. Server components unchanged except passing `activeCount`; the floating button is the only new
   client code, and it reuses `FILTERS_PANEL_ID` / `SEARCH_FORM_ID` from `./ids`.
2. One IntersectionObserver, disconnected on unmount; no scroll listeners.
3. Compact system: `text-small` label, 44px height, tokens only.

## Security requirements

None new: no data, no server actions; the button only opens existing UI.

## Acceptance criteria

- Desktop 1024–1440px: after scrolling the results, the Filters panel stays visible under the
  header; on a 700px-tall window its content scrolls inside and "Apply filters" is reachable.
- Phone 390px: the floating button is hidden at the top, appears after scrolling past the search
  card, opens the filter sheet (with and without the Popover API), and hides again near the top.
- No horizontal scroll at 320px; axe stays at 0 violations on `/properties`.
- `typecheck`, `lint`, `test`, `build` pass.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- Edge walkthrough at 390px (with and without the Popover API) and 1440px / 1024×700
- `npm run e2e -- e2e/visitor.spec.ts` if the e2e branch may be reset (ask first)

## Manual test steps (after implementation)

1. `npm run dev`, open `/properties` on a laptop, scroll down the results: the Filters panel stays
   pinned under the header. Make the window short: the panel scrolls inside itself.
2. On your phone, open Explore and scroll: a green "Filters" button appears at the bottom. Tap it:
   the filter sheet opens. Apply a filter: the button then reads "Filters (1)".
3. Scroll back to the top: the floating button disappears and the search card's Filters button is
   there instead.
