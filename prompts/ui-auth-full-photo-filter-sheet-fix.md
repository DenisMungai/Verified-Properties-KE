# UI: full-panel auth photo + Explore filter sheet fix on phones

Two small changes, one prompt.

## Part A — the auth photo fills the whole story panel

### Goal

The living-room photo (`src/assets/images/auth-living-room.jpg`, from `prompts/ui-auth-panel-photo.md`)
covers the entire left story panel (the whole green area), edge to edge and top to bottom, instead
of sitting as a rounded 4:3 card inside it. The brand, headline, body and check-point row stay,
on top of the photo.

### Existing code inspected

`src/components/auth/AuthShell.tsx`: `<aside className="hidden bg-emerald-700 px-10 py-14 text-white lg:flex xl:px-16">`
holding brand, headline, body, the 4:3 photo card and the points row. Shared by sign-in, sign-up,
forgot/reset password and check-email. Hidden below `lg`.

### Decisions

- `aside` becomes `relative isolate overflow-hidden`; the photo is a `next/image` with `fill`,
  `object-cover`, `-z-20`, `placeholder="blur"`, `alt=""`, `sizes="(min-width: 1024px) 48vw, 0px"`.
  `bg-emerald-700` stays underneath as the loading colour.
- A wash keeps white text readable (WCAG AA on a bright, sunlit photo): `-z-10` layer
  `bg-gradient-to-b from-ink/85 via-ink/35 to-ink/85` — dark behind the headline at the top and
  the points at the bottom, lighter in the middle so the room shows.
- Layout inside the panel: brand + headline + body at the top, points row pinned to the bottom
  (`justify-between`, full panel height). The 4:3 card is removed.
- No change below `lg` (panel hidden, photo not downloaded).

### Files

- `src/components/auth/AuthShell.tsx`

## Part B — Explore filter sheet on phones

### Problem (reproduced 2026-11-02, 390×664, live site)

1. **Phones without the Popover API** (iOS Safari 16 and older, older Android browsers): the
   `popover` attribute does nothing, so the browser never hides the closed sheet. The sheet is
   `fixed inset-0` with no `display: none`, so it covers the page from the moment it loads, the
   Filters/close buttons do nothing, its own list can't scroll (`display: block`, so the
   `flex-1 overflow-y-auto` body is never height-limited and the `overflow-hidden` sheet clips it),
   and the page behind keeps scrolling and paints through it (no z-index). This matches the
   report: "the filter is the only thing occupying the phone, not scrollable, the rest underlays
   behind and is the only scrolling section."
2. **Phones with the Popover API**: the open sheet works, but a swipe on it scrolls the page
   behind (scroll chaining; the page is not locked), which feels the same way.

### Decisions

- **Hidden by default on phones, independent of browser support:** the sheet gets `max-md:hidden`
  and is shown only by `max-md:[&:popover-open]:flex` or `max-md:data-[open]:flex`. A browser that
  doesn't understand `:popover-open` drops that rule and keeps the sheet hidden.
- **JavaScript fallback for opening/closing:** when `HTMLElement.prototype` has no `showPopover`,
  `FiltersButton`, the close button, Apply and Reset toggle a `data-open` attribute on the sheet
  instead. With support, the native popover path is unchanged (still works without JavaScript).
- **Lock the page behind an open sheet** (phones only), two separate rules so an unknown selector
  can't cancel the other:
  `html:has(#search-filters:popover-open) { overflow: hidden }` and
  `html:has(#search-filters[data-open]) { overflow: hidden }`.
  Plus `overscroll-contain` on the sheet's scrolling body, and `z-50` on the sheet so nothing on
  the page paints over it in the fallback.
- The `md`+ sidebar is unchanged (it is always shown from `md`).

### Files

- `src/components/search/FilterDrawer.tsx` (classes, fallback toggle in `FiltersButton`, close,
  Apply, Reset)
- `src/app/globals.css` (scroll-lock rules)

## Security requirements

UI only. No data, auth, query or ranking changes.

## Acceptance criteria

- `/sign-in` and `/sign-up` at 1280×800 and 1440×900: the photo fills the whole left panel; text
  is readable (white on the darkened top and bottom); points row at the bottom; nothing below
  `lg` changes.
- Phone (390×664) **with** popover support: page loads with the sheet hidden; Filters opens it;
  swiping in the sheet does not scroll the page; close / Apply / Reset close it; page scroll
  returns.
- Phone **without** popover support (emulated by removing the API): the page loads with no sheet
  covering it; Filters opens it via the fallback; it shows above everything; close / Apply /
  Reset work; the page behind does not scroll while open.
- `md`+ sidebar unchanged.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.

## Checks to run

Checks above; then a scripted Edge walkthrough against `npx next start -p 3005`: the auth pages at
1280×800 / 1440×900 (screenshots), and the filter sheet at 390×664 in both modes (native popover
and emulated no-popover), checking visibility on load, open, scroll lock, close and apply.

## Manual test steps

1. Restart `npm run dev`; open http://localhost:3000/sign-in at desktop width: the photo fills the
   whole left panel with the text on top.
2. Open http://localhost:3000/properties?mode=rent in phone mode (Ctrl+Shift+M): no filter sheet
   on load; tap Filters; swipe inside it — the page behind stays put; tap ✕; page scrolls again.
3. Tick Apartment → Apply filters: sheet closes, "Filters (1)".
4. After deploying, open the live Explore page on the phone that showed the problem.
