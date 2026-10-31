# UI — Compact, premium design system (existing colour palette kept)

## Goal

Make the whole site look **compact, premium and editorial** (Nike / SSENSE storefront density)
instead of big and zoomed in: a 6-step type scale where ~90% of the UI is `text-small` /
`text-micro`, tighter padding, 1px borders instead of shadows, a flatter radius scale, a 1440px
layout shell, and compact square-image property cards in 2 / 3 / 4-column grids.

**Approved change (user, 2026-10-31): do not change the colour palette.** Every existing colour
token (`emerald`, `mint`, `canvas`, `ink`, `slate`, `line`, `line-strong`, `surface-muted`,
`success`, `warning`, `danger`, `info`, `sand`) and every component's colour usage stays as it is
(green primary buttons, green wordmark, mint active states, dark footer, tinted status badges,
green focus outline). The brief's greyscale tokens, `sale` red and colour rules are **not**
applied. Only typography, sizing, spacing, radius, shadows and layout change.

This is a **visual and system refactor only**. No business logic, data fetching, routes, Server
Actions, queries or copy change, except where a rule below says so.

## References read

- `AGENTS.md`: precedence, design rules (90% root, 44px targets, 3:1 control borders), wording
  rules ("Profile verified"), Next 16.4 / Cache Components notes, Tailwind v3.
- The user's design-system brief (sections 0–11, Do / Don't list), minus its colour sections.
- `docs/implementation-plan-v2.md` UI rules: verified badge wording, paid placement disclosed,
  meaning never carried by colour alone.
- `node_modules/@fontsource/poppins`: `latin-400/500/600/700/800.css` exist.
- Lucide React renders `<svg class="lucide …" stroke-width="2">`; CSS `stroke-width` overrides it.

## Existing code inspected

- `tailwind.config.ts`: colour tokens (kept); 14 font sizes; overridden radii (`sm` 8px … `2xl`
  24px, `pill`); `card` / `popover` / `focus` shadows; spacing `control` 44px, `control-lg` 48px,
  `header` 72px; `max-w-container` 80rem (1152px at 90%).
- `src/app/globals.css`: `--vp-*` variables, 90% root, focus outline + ring, reduced motion.
- `src/app/layout.tsx`: all-subset Poppins 400–700.
- 115 TSX files. Hard-coded styling to replace: ~330 old font-size classes, 25 shadows, 185
  radius classes, ~80 large paddings, `max-w-container` ×8.
- Base kit `src/components/ui/*`, shell (`SiteHeader` 72px, `MobileMenu` full-screen dialog,
  `AccountMenu` popover with shadow, `SiteFooter`, `PageContainer`, `Logo`).
- `PropertyCard` (4:3 image, shadow, `text-h3` price, `p-4 md:p-5`), grids `gap-6
  sm:grid-cols-2 xl:grid-cols-3` and home `lg:grid-cols-4`.
- `ListingImage`: `next/image` + custom loader over stored **WebP** variants, lazy by default.
- Home, search (17.5rem `FilterPanel` in `FilterDrawer`), detail (gallery, sticky
  `ListerPanel`, Similar listings grid, mobile sticky bar with shadow), account/admin layouts.
- No test asserts on class names.

## Decisions and assumptions

1. **Colours unchanged** (see Goal). Where the brief names a colour for a state (black active nav,
   black primary button, black badges, greyscale card wells), the component keeps its current
   palette colour instead. The `--vp-*` colour variables stay.

2. **Type scale** replaced by the brief's 6 sizes; old sizes deleted from config:
   `display` 3.5rem/1.02/-0.055em/700, `display-sm` 2.25rem/1.05/-0.045em/700, `title` 1.125rem/1.5rem/600,
   `body` 0.875rem/1.5rem, `small` 0.75rem/1.15rem, `micro` 0.625rem/0.9rem/0.02em.

   | Old | New |
   |---|---|
   | `text-display` (home H1) | hero clamp: `text-[2.5rem] sm:text-[clamp(2.6rem,5.8vw,4.75rem)] font-bold leading-[0.98] tracking-[-0.055em]` |
   | `text-h1`, `text-h1-sm`, `text-display-sm` | `text-display-sm` |
   | `text-h2`, `text-h3`, `text-h4` | `text-title`; inside dense cards / table headings `text-small font-semibold` |
   | `text-body-lg`, `text-body` | `text-body` |
   | `text-body-sm` | `text-small` (paragraph intros may use `text-body`) |
   | `text-button` | `text-small font-semibold` |
   | `text-caption` | `text-micro` |
   | `text-label` | `text-micro font-semibold tracking-wide` (still `uppercase` where it was) |
   | `text-price` | `text-display-sm` |

   No `text-base`, `text-lg`, `text-xl`+ for UI text.

3. **Radius**: delete the `borderRadius` override (Tailwind defaults return: `sm` 2px, default 4px,
   `md` 6px, `lg` 8px, `xl` 12px, `full`). `rounded-pill` → `rounded-full`, alias removed. Scale:
   property cards `rounded-sm`; inputs `rounded`; buttons / panels `rounded-lg`; menu items
   `rounded-md`; hero, home search, gallery, popovers `rounded-xl`; pills, avatars, icon buttons,
   search bars `rounded-full`. Old `rounded-xl` panels → `rounded-lg`; `rounded-2xl` → `rounded-xl`.

4. **Shadows**: delete `card` and `popover` tokens and all `shadow`, `shadow-md`, `shadow-card`,
   `shadow-popover` uses. Only `hover:shadow-sm` on property cards remains. The `focus` ring token
   stays (a focus indicator, not a drop shadow).

5. **Form controls** keep `border-line-strong` (3:1, AGENTS.md). Touch targets (px): buttons,
   inputs, selects, nav and menu items stay 44px (`control-lg` 48px for hero / checkout CTAs).
   Secondary controls use the brief's 32px floor: pagination squares, toolbar selects, card heart
   and chip remove (the heart and chip remove keep an invisible 44px hit area).

6. **Fonts**: `@fontsource/poppins/latin-{400,500,600,700,800}.css` (800 only for the wordmark).
   All-subset imports removed.

7. **Icons**: global `svg.lucide { stroke-width: 1.75 }`; large decorative `[stroke-width:1.5]`;
   image placeholders `[stroke-width:1]`. Sizes: `size-4` inline/buttons/header, `size-5` sidebar
   nav, `size-3` tiny card actions.

8. **Layout shell**
   - `PageContainer`: `mx-auto w-full max-w-page px-4 sm:px-5 md:px-[4vw]` (1440px); `width="text"`
     → `max-w-text` (1160px) for text-heavy pages (how it works, auth, receipts).
   - Header: `sticky top-0 z-40 min-h-[66px] border-b border-line bg-white/95 backdrop-blur`; logo
     left, nav centred (`gap-4`, `text-[10px] font-medium 2xl:text-small`, active
     `font-semibold` in the existing active colour), compact actions right; AccountMenu avatar 40px.
   - Logo: `text-[15px] font-extrabold tracking-[-0.06em]` (existing green), with `BRAND.tagline`
     (existing copy) below in `text-[9px] uppercase tracking-wide text-slate-600`.
   - MobileMenu: slide-out drawer on the same `<dialog>` (focus trap, Esc, close on navigation):
     `w-[17.5rem] max-w-[85vw]` pinned left, `backdrop:bg-ink/40`, `text-small` links, active link
     in the existing mint/green active style. No slide animation.
   - AccountMenu popover: `rounded-xl border border-line bg-white p-2`, no shadow, items
     `rounded-md px-3 text-small`.
   - Footer: keeps its dark colours; `mt-12`, 2-column grid, brand `text-title font-bold
     tracking-tight`, links `text-small`, copyright `text-micro`.

9. **Not added** (no property-marketplace equivalent or it would add copy/features): announcement
   bar, header search field, cart/alerts icons, size/colour selectors, quantity stepper, sale
   prices, rank numbers, "Add to cart"/"Choose size" card buttons. The lister row sits at `mt-auto`
   so card bottoms align.

10. **Property card**: `relative flex w-full flex-col overflow-hidden rounded-sm border border-line
    bg-white transition-shadow hover:shadow-sm`; image `aspect-square border-b border-line`
    (existing placeholder colour); no-photo fallback becomes a centred Lucide `House` icon
    (`[stroke-width:1]`, existing muted colour) on the existing placeholder background; heart
    `absolute right-2 top-2`, 32px circle, no border/shadow, 44px hit area; badges `absolute
    bottom-2 left-2`, `rounded-sm px-2 py-1 text-micro font-medium`; info `p-3 min-h-32`; title
    `line-clamp-2 min-h-8 text-small font-medium leading-tight`; location `mt-1 truncate text-micro
    uppercase tracking-wide`; facts `text-micro`; price `mt-2 text-small font-bold`; lister row
    `mt-auto pt-2` / `border-t pt-2 text-micro`. Grids everywhere: `grid grid-cols-2 sm:grid-cols-3
    xl:grid-cols-4 gap-3 sm:gap-4`. `CARD_IMAGE_SIZES` → `(min-width: 1280px) 340px,
    (min-width: 640px) 33vw, 50vw`. Skeletons match.

11. **`<picture>`**: not changed — variants are already WebP-only via `srcset`, lazy by default.

12. **Home**: hero `rounded-xl border border-line bg-white`, `min-h-[400px] sm:min-h-[520px]`,
    copy (`p-7 sm:p-10 lg:p-12`) + 48% visual panel (existing illustration, existing colours);
    eyebrow as a small tag (`rounded-sm px-2 py-1 text-micro font-medium`, existing green), clamp
    H1, `text-body max-w-md` line, primary "Browse all properties" button with arrow (moved up from
    the listings header). `HomeSearch` below: `rounded-xl border p-4 sm:p-5`, no shadow, no
    overlap. `LocationTiles` → horizontal `snap-x overflow-x-auto hide-scrollbar` rail of 80px
    `rounded-full border border-line bg-white` circles with a `MapPin` (`size-7`), county
    `text-small font-medium`, note `text-micro`; hover uses the existing mint/green hover colours.
    Sections `gap-16`; heading rows `mb-4 flex items-end justify-between`.

13. **Search**: H1 `text-display-sm`, count line `text-body`. `SearchBar` input `rounded-full
    pl-9 text-small`. Grid `md:grid-cols-[176px_minmax(0,1fr)]`, sidebar `sticky top-[66px]
    self-start`; price min/max stack. `ResultsHeader` → toolbar row (`min-h-10 border-y
    border-line py-1.5 text-small`, sort select `min-h-8 rounded px-3 text-small`). `FilterDrawer`
    stays below `md` (breakpoint moved from `lg`). Chips / pills `rounded-full px-4 text-small
    font-medium`.

14. **Detail**: structure kept (gallery, then content + sticky contact panel). Breadcrumb
    `text-small`, H1 `text-display-sm`, gallery frames `rounded-xl border border-line`, price in
    `ListerPanel` `text-display-sm`, description below `border-t pt-6`. Similar listings become a
    horizontal `snap-x` rail of `w-64` cards with square prev/next buttons (one outlined, one
    filled primary), new client `CardRail` that only scrolls. Mobile sticky bar: `border-t`, no
    shadow.

15. **Account / admin**: sidebar `lg:grid-cols-[17.5rem_minmax(0,1fr)]`; nav links `text-small
    font-medium`, icons `size-5` where present. Panels `rounded-lg border border-line bg-white`
    `p-5`/`p-6`. Tables `text-small`, headings `text-micro uppercase tracking-wide`. `StatCard`
    value `text-display-sm`. Checkout summary `sticky top-24 p-6`, total `text-title`.

16. **Buttons**: shape only — `rounded-lg px-5 text-small font-semibold transition-colors`,
    `h-control` (lg `h-control-lg`); variant colours unchanged.

17. **Other controls**: `SegmentedControl`, `Chip`, `Pagination` (32px), `EmptyState`
    (`text-title` heading, `text-small` line), `Badge` (`text-micro`), `Field` labels `mb-1.5
    text-small font-medium`, inputs `rounded px-4 text-small`, checkboxes `size-4` in 44px rows.
    Colours unchanged.

18. **Global CSS**: keep tokens and focus rule; add `scroll-behavior: smooth` (off under reduced
    motion), inherited form fonts, `img { display:block; max-width:100% }`, `svg.lucide` stroke
    width, `.hide-scrollbar`, component classes (`.card`, `.btn-primary`, `.btn-secondary`,
    `.market-card`, `.market-image`, `.market-info`, `.market-quick`) built from the **existing**
    colour tokens, and print rules (white background, header/footer/sidebar hidden).

19. **AGENTS.md** design rules: type scale, radius, no shadows, 1440px shell and 44/32px targets
    updated; colour rules unchanged.

20. **Styleguide** updated to show the new type scale and components.

## Files likely to change

`tailwind.config.ts`, `src/app/globals.css`, `src/app/layout.tsx`, `AGENTS.md`, all of
`src/components/**`, new `src/components/search/CardRail.tsx`, and class names in every
`src/app/**/{page,layout,error,loading,not-found}.tsx` and the styleguide. Nothing under
`src/db`, `src/lib`, actions, route handlers, scripts or migrations.

## Implementation requirements

1. Config: replace `fontSize`; remove `borderRadius`; `boxShadow` keeps only `focus`; spacing
   adds `gutter` 1rem, `sidebar` 17.5rem, `page-x` 4vw, keeps `control`/`control-lg`, drops
   `header`; `maxWidth` `page` 1440px, `text` 1160px, keeps `prose`, `modal`, drops `container`.
   Colours untouched.
2. Global CSS + fonts (decisions 6, 7, 18).
3. Base kit, then shell, then card/grids, then pages (home, search, detail, account, billing,
   admin, auth, pricing, how it works, 404, errors, styleguide).
4. Walk every TSX file; replace sizes / radius / shadows / paddings per the tables. Card padding
   ≤ `p-3`; panels `p-5`/`p-6`; hero `p-7 sm:p-10 lg:p-12`; page headers `mb-7`; grids
   `gap-3 sm:gap-4`.
5. Headlines bold with negative tracking; tiny labels uppercase `tracking-wide`; links
   `underline-offset-4`.
6. Motion: `transition-colors` / `transition-shadow` only.
7. Accessibility intact: focus outlines, `aria-label`s, `aria-pressed`, targets per decision 5.
8. Leftover sweep must return nothing:
   `rg -n "text-(h[1-4]|h1-sm|body-sm|body-lg|caption|label|button|price)\b|shadow-(card|popover|md|lg|xl)|\bshadow\b|rounded-(pill|2xl|3xl)|max-w-container|text-(base|lg|xl|2xl|3xl)\b|h-header" src --glob "*.tsx"`

## Security requirements

- No change to what data is fetched or rendered; nothing hidden today becomes visible.
- Verified badge renders where it does today with the same wording; Featured disclosure stays.
- The only new client component (`CardRail`) receives server-rendered children and only scrolls.
- No new external requests (fonts self-hosted, no stock images).

## Acceptance criteria

- 90% root, Poppins latin 400–700 (+800 wordmark) only.
- Colours identical to before on every surface.
- Leftover sweep returns nothing.
- No drop shadows except a card's hover `shadow-sm`.
- Grids 2 / 3 / 4 columns at <640 / ≥640 / ≥1280px, square images, aligned bottoms; content ≤1440px.
- Header ~66px; mobile drawer 17.5rem with overlay, focus trap, Esc, close on navigation.
- ~90% of UI text at `text-small` / `text-micro`; buttons 44px with `text-small font-semibold`.
- Pages render without breakage at 375 / 768 / 1280 / 1920px.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.
- No behavioural change (forms, links, save heart, filters, gallery, pagination, sort, checkout).

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, the leftover sweep, and a visual
check with `npm run dev` + Edge via `playwright-core` at 375 / 768 / 1280 / 1920px.

## Manual test steps (after implementation)

1. `npm run dev`, open http://localhost:3000 at 100% zoom.
2. Home: bordered hero card with tight bold headline and green "Browse all properties"; search
   card below without a shadow; location rail scrolls sideways with no scrollbar; listings 4
   columns wide, 2 on a phone.
3. Card: square photo, small heart top-right (saves when signed in), badges bottom-left, small
   title, uppercase location, bold small price, aligned lister row; hover shows a faint shadow.
4. `/properties`: toolbar row with count and Sort; 176px sidebar ≥768px, Filters drawer below;
   apply/remove a filter chip; paginate.
5. Detail: breadcrumb, large title, rounded gallery, contact panel price, Similar listings rail
   with two square arrow buttons; phone bottom bar has a border, no shadow.
6. Sign in / sign up: 44px inputs, focus outline when tabbing, error text on bad input.
7. Lister account: sidebar, listings, editor stepper, billing, checkout summary, receipt + print
   preview (no header/footer/sidebar).
8. Admin: dashboard, listing review, reports.
9. Resize to 375 / 768 / 1280 / 1920px on home, search, detail: no horizontal overflow.
