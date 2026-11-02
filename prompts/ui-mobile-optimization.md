# UI: mobile optimisation (phones, < 640px)

## Goal

Make the live site comfortable on phones without changing the desktop/tablet compact design:
readable text, no iOS zoom-on-focus, honest 32px secondary controls, a sticky contact bar that
never hides content, and a few layout fixes found by loading the live site at 360px and 390px.

## References read

- `AGENTS.md` (design rules: six font sizes, 44px controls, 32px secondary controls, radii, tokens)
- `prompts/ui-compact-design-system.md` (compact scale; it has no phone-specific rule)
- `tailwind.config.ts`, `src/app/globals.css` (90% root, type scale), `src/lib/cn.ts`

## What was checked (live site, 2026-11-02)

https://verifiedpropertieske.vercel.app in Edge (playwright-core), mobile emulation, 360×740 and
390×844 at 2× DPR: `/`, `/properties`, `/properties?mode=rent`, filter sheet, the mobile menu,
`/properties/3-bedroom-apartment-2398c4`, `/pricing`, `/how-it-works`, `/sign-in`, `/sign-up`,
`/forgot-password`. Each page was checked for horizontal overflow, controls under 32px and text
size.

Good already: no page scrolls sideways; header, drawer menu and filter sheet work; tables in
account/admin/billing already switch to cards below `md` (code-inspected; signed-in pages were not
loaded).

Problems found:

1. **Text is too small on phones.** At the 90% root, `text-small` = 10.8px (most UI: labels,
   buttons, links, list items) and `text-micro` = 9px (badges, hints, field labels such as
   "LOCATION", the gallery counter, the footer ©). `text-body` = 12.6px.
2. **iOS Safari zooms in on every form field.** Inputs, selects and textareas render at 10.8px;
   iOS zooms any focused control under 16px (sign-in, sign-up, search, filters, all account forms).
3. **"32px" secondary controls are really 28.8px.** `h-8` / `size-8` / `min-w-8` are rem-based,
   so the sort select (29px), pagination buttons and the card heart are below the 32px rule.
4. **Sticky "Contact lister" bar covers the footer** on the listing page: at the bottom of the
   page the last footer row and © line sit under the fixed bar.
5. **Location rail clips:** the first caption ("Apartments & homes") runs into the screen edge,
   and Nakuru, the 4th tile, is off-screen with no hint that the row scrolls.
6. **Footer links are indented** 8px out of line with the brand text (the `px-2` hit padding
   shifts the text).
7. **Small standalone links:** "Forgot password?" is a 24px-tall target.

## Decisions

- **Phone breakpoint = below `sm` (< 640px).** Tablet and desktop keep the compact scale exactly.
- **Phone type scale via CSS variables**, so all existing classes keep working and the six-size
  rule holds (no new font-size token). Values at the 90% root:

  | Token        | Desktop (now)     | Phone (< 640px)            |
  | ------------ | ----------------- | -------------------------- |
  | `display`    | 3.5rem ≈ 50px     | unchanged                  |
  | `display-sm` | 2.25rem ≈ 32px    | unchanged                  |
  | `title`      | 1.125rem ≈ 16px   | 1.25rem ≈ 18px, lh 1.65rem |
  | `body`       | 0.875rem ≈ 12.6px | 1rem ≈ 14.4px, lh 1.6rem   |
  | `small`      | 0.75rem ≈ 10.8px  | 0.9rem ≈ 13px, lh 1.35rem  |
  | `micro`      | 0.625rem ≈ 9px    | 0.75rem ≈ 10.8px, lh 1rem  |

  rem keeps the user's own browser font-size setting in effect.
- **Form controls: 16px on phones** with one global rule in `globals.css` after the utilities
  (text inputs, selects, textareas; not checkboxes/radios). It is a platform requirement, not a
  seventh type size; documented as such in AGENTS.md.
- **New spacing token `control-sm: 32px`** (px, like `control`), replacing `h-8` / `size-8` /
  `min-w-8` on the sort select, pagination buttons and the small save heart. Taught to `cn.ts`.
- **Sticky bar space** is reserved with CSS only: the bar gets `data-mobile-bar`, and
  `body:has([data-mobile-bar])` gets bottom padding equal to the bar's height below `lg`. No JS.
- **Location tiles on phones:** a 2×2 grid of compact rows (40px icon circle + county + note,
  left-aligned) so all four show; the current rail stays from `sm` up.
- Not changing: page structure, the hero, the header/drawer, search-page layout, colours, radii,
  the hard-coded 9px brand tagline under the logo (logo lockup, not UI text).

## Files likely to change

- `tailwind.config.ts`: `fontSize` values read CSS variables; add `spacing.control-sm`
- `src/app/globals.css`: `--vp-text-*` variables (desktop defaults, phone overrides below 640px),
  16px form-control rule, sticky-bar padding rule
- `src/lib/cn.ts`: add `control-sm` to spacing
- `src/components/search/SortSelect.tsx`, `src/components/search/Pagination.tsx`,
  `src/components/listing/SaveButton.tsx`: `h-8`/`size-8`/`min-w-8` → `control-sm`
- `src/app/properties/[slug]/page.tsx`: `data-mobile-bar` on the fixed bar
- `src/components/search/LocationTiles.tsx`: 2×2 phone grid, rail from `sm`
- `src/components/layout/SiteFooter.tsx`: `-mx-2` on the link list so text lines up
- `src/components/auth/SignInForm.tsx`: "Forgot password?" gets `min-h-control` (no `-mt-2` shift
  that makes it overlap the field)
- `AGENTS.md`: one line under the design rules about the phone scale and 16px controls
- `src/app/styleguide/page.tsx` only if it lists the type scale in px

## Implementation requirements

1. `globals.css` `:root`: `--vp-text-display`, `--vp-text-display-sm`, `--vp-text-title`,
   `--vp-text-body`, `--vp-text-small`, `--vp-text-micro` plus matching `--vp-leading-*`, set to
   today's values. `@media (max-width: 639.98px)` overrides title/body/small/micro per the table.
2. `tailwind.config.ts` `fontSize` entries use `var(--vp-text-…)` / `var(--vp-leading-…)`;
   letter-spacing and weight unchanged. Update the scale comment with phone sizes.
3. After `@tailwind utilities`, phone-only rule:
   `input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]), select, textarea { font-size: 16px; }`
   (its specificity beats the single `text-small` class). Placeholder sizes follow automatically.
4. Sticky bar: `[data-mobile-bar]` height ≈ 70px; `@media (max-width: 1023.98px) { body:has([data-mobile-bar]) { padding-bottom: <bar height> } }`.
   Use a CSS variable for the height so the bar and the padding share one value.
5. Replace the five `h-8` / `size-8` / `min-w-8` secondary-control uses (not icon sizes) with
   `h-control-sm` / `size-control-sm` / `min-w-control-sm`. The heart keeps its 44px `after:` hit area.
6. Location tiles: `< sm` → `grid grid-cols-2 gap-3`, each tile a row (`flex items-center gap-3`,
   `rounded-sm border border-line bg-white p-3`, circle `size-10`, icon `size-5`); `sm+` → current
   rail unchanged.
7. Footer: `-mx-2` on the `<ul>` so link text aligns with the brand while keeping the padded hit area.
8. Check that nothing wraps badly with the bigger phone sizes: header, card meta row
   ("3 beds · 2 baths · 1 parking"), segmented controls (Buy/Rent/Land, Any/1+…4+), pricing cards,
   the sticky bar (price + button on one line at 360px), account nav pills. Fix only real breaks,
   with the smallest change.

## Security requirements

CSS and markup only. No data, auth, permission or route changes. No secrets touched.

## Acceptance criteria

- At 360px and 390px: no horizontal scroll on any audited page; `text-small` computes to ≈13px and
  `text-micro` to ≈10.8px; every text input, select and textarea computes to 16px.
- At 640px and wider, computed sizes are identical to today (10.8 / 9 / 12.6 / 16.2px).
- Sort select, pagination buttons and card heart measure 32px; heart hit area still 44px.
- Listing page on a phone: scrolled to the bottom, the © footer line is fully visible above the
  sticky bar.
- Home on a phone: all four locations visible without sideways scrolling; captions don't touch the edge.
- Footer link text lines up with the brand text.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then a scripted Edge
walkthrough (playwright-core in the scratchpad) of the audited pages at 360, 390, 768 and 1280px
against `npx next start -p 3005`, repeating the overflow / target / font-size audit and comparing
screenshots before and after. Photos may show grey placeholders on a local production build;
that is expected.

## Manual test steps (after implementation)

1. Restart your dev server (`npm run dev`) so the layout CSS reloads, then open
   http://localhost:3000.
2. In Edge/Chrome DevTools, toggle the device toolbar (Ctrl+Shift+M) and pick iPhone 12 Pro
   (390px) then a 360px Android size.
3. Home: text reads comfortably; the four locations show as a 2×2 grid; footer links line up.
4. Tap the search field: on a real iPhone the page must not zoom in. Repeat on `/sign-in`.
5. `/properties?mode=rent`: the sort select and pagination are 32px tall; open Filters and check
   the sheet.
6. Open a listing, scroll to the very bottom: the © line sits above the "Contact lister" bar.
7. Switch to a desktop width (1280px): everything looks exactly as before.
8. After pushing, repeat 3–6 on your phone at https://verifiedpropertieske.vercel.app.
