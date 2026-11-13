# UI: iPhone top/bottom colour bands (theme colour and overscroll)

## Goal

On iPhones (Safari), stop the coloured bands that show above and below the page:

1. **Top — green band.** Safari paints its status/top bar with the page's `theme-color`, which is
   Deep green `#087443` (`src/app/layout.tsx` `viewport.themeColor`). The header under it is
   white, so a green strip sits above a white header.
2. **Bottom — light band.** When the page bounces past its end (iOS rubber-band overscroll),
   Safari shows the page's root background, the light canvas `#F7F8F5`, under the dark
   Charcoal footer (`bg-ink`). The same light colour shows when bouncing past the top.

After the fix, the top bar and the top bounce area match the white header, and the bottom bounce
area matches the Charcoal footer.

## References read

- `AGENTS.md` (design rules, tokens, Cache Components notes, checks)
- `prompts/ui-mobile-optimization.md` (phone rules, `data-mobile-bar`)
- `prompts/ui-clear-header-over-hero.md` context via `HeaderOverlayFlag.tsx`

## Existing code inspected

- `src/app/layout.tsx`: `viewport.themeColor = "#087443"`; `<body class="flex min-h-dvh flex-col">`
  with `SiteHeader`, `main`, `SiteFooter`.
- `src/app/manifest.ts`: `theme_color: "#087443"`, `background_color: "#F7F8F5"`.
- `src/app/globals.css`: `body { @apply bg-canvas … }`; `html` has no background, so the body's
  canvas colour spreads to the whole canvas, including the overscroll areas. Print block sets
  `body { background: #fff }`.
- `src/components/layout/SiteHeader.tsx`: sticky header, `bg-white/95` (clear over the home hero
  at the top, via `HeaderOverlayFlag`).
- `src/components/layout/SiteFooter.tsx`: `footer.mt-auto.bg-ink`.
- `src/components/layout/HeaderOverlayFlag.tsx`: existing pattern for a tiny client component
  with a passive scroll listener.

## Decisions and assumptions

- **Theme colour → white** (`#ffffff`) in both `viewport.themeColor` and the manifest
  `theme_color`, so the browser bar matches the solid white header on every page. Android Chrome's
  address bar also becomes white instead of green, which matches the header there too. The
  manifest `background_color` (splash) stays canvas.
- **Overscroll colour follows the end of the page you're near.** Safari paints the bounce area
  with one colour, the root (`html`) background colour, for both the top and the bottom, so a
  single static colour can't match both the white header and the Charcoal footer. Fix:
  - `html` gets an explicit `background-color: var(--vp-white)`. The body keeps its canvas
    background and `min-h-dvh`, so nothing visible on the page changes; only the bounce areas do.
  - A small client component sets `data-overscroll="end"` on `<html>` while the page is scrolled
    past its halfway point (`scrollY > (scrollHeight − innerHeight) / 2`, and the page actually
    scrolls). CSS then makes `html` Charcoal (`var(--vp-charcoal)`, same as `ink`). The top
    bounce can only happen at the top (white). The bottom bounce can only happen at the end, where
    the attribute is set (Charcoal).
  - Pages too short to scroll keep white (top bounce matches the header; no fix for the bottom
    there, which is rare on phones).
- No fixed "backdrop" elements or footer box-shadow tricks: iOS 26 Safari tints its bars from
  fixed elements near the edges, and Safari doesn't paint shadows outside the document reliably.
- Not touching `overscroll-behavior` (turning bounce off would also remove Safari's
  pull-to-refresh).

## Files likely to change

- `src/app/layout.tsx`: theme colour; render the new component.
- `src/app/manifest.ts`: `theme_color`.
- `src/app/globals.css`: `html` background + `html[data-overscroll="end"]`; print reset for `html`.
- `src/components/layout/OverscrollTint.tsx` (new, `"use client"`, renders `null`).

## Implementation requirements

- `OverscrollTint`: `useEffect` adds passive `scroll` and `resize` listeners, runs `update()` once
  on mount, and removes the listeners and the attribute on unmount. `update()` reads
  `document.documentElement.scrollHeight`, `window.innerHeight`, `window.scrollY`, and toggles
  `data-overscroll="end"` only when it changes. Explain the why in a short doc comment.
- Render it once in the root layout inside `<body>` (no Suspense needed: no request data).
- CSS in `@layer base`:
  `html { background-color: var(--vp-white); }`
  `html[data-overscroll="end"] { background-color: var(--vp-charcoal); }`
- Print: `@media print { html { background: #fff; } }` next to the existing body rule.
- Update the manifest comment so it still describes the colours accurately.
- No other visual change: header, footer, body canvas, mobile bars and the home hero look the
  same as before.

## Security requirements

None beyond the usual: client-only presentation code, no data, no new env vars.

## Acceptance criteria

- Page `<meta name="theme-color">` is `#ffffff`; `/manifest.webmanifest` `theme_color` is `#ffffff`.
- At the top of any page `<html>` has no `data-overscroll`; computed `html` background is white.
- Scrolled to the bottom of a long page (`/`, `/properties`, a listing), `<html>` has
  `data-overscroll="end"` and its computed background is `rgb(23, 35, 29)`.
- Scrolling back up past halfway removes the attribute. Client-side navigation (new page starts
  at the top) ends with no attribute.
- No visible change to the page itself at any width.
- iPhone: no green strip above the header; bouncing past the top shows white, bouncing past the
  footer shows Charcoal.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (layout and manifest changed)
- Edge (playwright-core) at 390×844: load `/` and `/properties`, assert the theme-color meta,
  then scroll to the bottom and back, asserting the attribute and computed `html` background.

## Manual test steps

1. `npm run dev`, open `http://localhost:3000` (or the Vercel preview) on an iPhone in Safari.
2. Top of the home page: the status bar area above the header is white, not green.
3. Pull down at the top: the bounce area is white.
4. Scroll to the end of the page and keep pulling up: the area under the footer is dark Charcoal,
   matching the footer, not light grey.
5. Repeat on `/properties` and on a listing page (`/properties/<slug>`, which has the fixed
   contact bar) and on `/pricing`.
6. Desktop: nothing looks different.
