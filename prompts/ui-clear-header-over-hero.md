# UI: clear (transparent) header over the home hero

## Goal

On the home page, make the top navigation bar clear: no white background or bottom border, so
the hero house photo runs up behind it to the top of the window. Once the visitor scrolls, the
bar turns back into the normal solid white sticky header so it stays readable over the page.
Every other page keeps today's solid header.

## References read

- `AGENTS.md` design rules (sticky 66px header, 44px touch targets, colour tokens, no shadows,
  readable contrast, Cache Components: request-time reads inside `<Suspense>`)
- `prompts/ui-hero-auth-photos.md` (photo hero, charcoal overlay)
- `prompts/ui-sticky-account-nav.md` (header `sticky top-0 z-40`, 66px)
- `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/use-selected-layout-segment.md`:
  under Cache Components, route hooks in the root layout suspend on pages with unknown dynamic
  params, so they need a `<Suspense>` boundary; on `/` they resolve at prerender
- Tailwind 3.4 `group-has-[…]` / named group variants

## Existing code inspected

- `src/app/layout.tsx`: `SiteHeader` (server) above `<main>` in the root layout
- `src/components/layout/SiteHeader.tsx`: `<header class="sticky top-0 z-40 min-h-[66px]
  border-b border-line bg-white/95 backdrop-blur">`; logo, centred nav (`text-slate-700`, active
  `text-emerald-700`), desktop actions (Log in secondary white button, Get started primary, or
  the white `AccountMenu` pill), mobile hamburger (`text-ink`)
- `src/components/layout/Logo.tsx`: `tone="brand" | "inverse"` colours
- `src/components/layout/MobileMenu.tsx`: the drawer `<dialog>` is rendered **inside** the
  header, so header-wide colour changes must not reach the drawer's contents
- `src/components/layout/NavLink.tsx`: `usePathname` inside `<Suspense>` for the same reason
- `src/app/page.tsx`: hero `<section>` under the header, `min-h-[400px] sm:min-h-[520px]`,
  `bg-ink/55` wash (below `lg`) and left-to-right gradient (`lg`+)

## Decisions and assumptions

1. **"Clear" means transparent over the hero photo**, on the home page only. Other pages have no
   photo under the header, so they stay solid white.
2. **Solid again after scrolling.** At the very top (scrolled less than 16px) the bar is clear;
   past that it switches to the current `bg-white/95 backdrop-blur border-line` style with a short
   colour transition. The header stays sticky as today.
3. **How the header knows it is on the home page at the top**: a tiny client component,
   `HeaderOverlayFlag`, rendered inside the header within `<Suspense fallback={null}>`. It uses
   `usePathname()` plus a passive scroll listener, and renders a hidden marker
   `<span data-header-overlay hidden />` only when the path is `/` and the page is at the top.
   The header uses `group/header` and Tailwind `has-[[data-header-overlay]]:` variants for its
   own background and border, and children use `group-has-[[data-header-overlay]]/header:` for
   their colours. Why this and not a client wrapper around the whole header: the header stays
   a server component, nothing renders twice, and on `/` the marker is in the prerendered HTML,
   so the bar is clear on first paint with no white flash. On pages with unknown dynamic params
   the flag suspends to `null`, which means "solid", the right answer there.
4. **The hero slides up behind the header**: the hero section gets `-mt-[67px]` and `pt-[67px]` (66px bar + 1px border),
   and its minimum heights grow by 67px (`min-h-[467px] sm:min-h-[587px]`), so the visible
   hero below the bar is the same size as now and the text stays centred in it.
5. **Readable nav over the photo**: a top fade added to the hero,
   `bg-gradient-to-b from-ink/60 to-transparent` over its top ~160px, so white nav text holds
   up over the bright sky and stone at the top of the photo.
6. **Colours while clear** (header elements only, never the drawer's contents):
   - logo wordmark `text-white`, tagline `text-white/80` (the same as the Logo's existing
     `inverse` tone)
   - nav links `text-white/90 hover:text-white`; the active link `text-white font-semibold` with
     an underline (`underline underline-offset-8 decoration-2`), since Deep green would be
     unreadable on the photo
   - hamburger icon `text-white`, hover `bg-white/10`
   - "Log in" (white secondary button), "Get started" (Forest primary) and the account pill
     (white) stay as they are; they already read clearly on the dark photo
   - background `bg-transparent`, border `border-transparent`, no backdrop blur
7. **Focus rings and touch targets unchanged.** Keyboard focus keeps the existing visible rings.

## Files likely to change

- `src/components/layout/HeaderOverlayFlag.tsx` (new, client)
- `src/components/layout/SiteHeader.tsx` (group, variants, flag)
- `src/components/layout/Logo.tsx` (optional `overlay` prop that adds the clear-state classes)
- `src/components/layout/MobileMenu.tsx` (hamburger button classes only)
- `src/app/page.tsx` (hero negative margin, padding, heights, top fade)

## Implementation requirements

- `HeaderOverlayFlag` (`"use client"`): `const pathname = usePathname()`; `atTop` state from
  `window.scrollY < 16`, initialised `true`, updated by a passive `scroll` listener (and once on
  mount, so a reload half-way down the page is solid). Returns the hidden marker only when
  `pathname === "/" && atTop`, otherwise `null`. Threshold as a named constant.
- `SiteHeader`: header classes become `group/header sticky top-0 z-40 min-h-[66px] border-b
  border-line bg-white/95 backdrop-blur transition-colors duration-200
  has-[[data-header-overlay]]:border-transparent has-[[data-header-overlay]]:bg-transparent
  has-[[data-header-overlay]]:backdrop-blur-none print:hidden`. Render
  `<Suspense fallback={null}><HeaderOverlayFlag /></Suspense>` inside the header. Nav link
  classes get the clear-state variants from decision 6. Update the header's doc comment.
- `Logo`: add `overlay?: boolean`; when true, append
  `group-has-[[data-header-overlay]]/header:text-white` (and `/80` on the tagline). Only the
  header's own Logo passes `overlay`; the drawer's Logo does not.
- `MobileMenu`: the hamburger trigger only gets
  `group-has-[[data-header-overlay]]/header:text-white
  group-has-[[data-header-overlay]]/header:hover:bg-white/10`. Nothing inside the `<dialog>`
  changes.
- Hero (`src/app/page.tsx`): apply decision 4 and add the decision 5 fade as another
  `aria-hidden` overlay layer (`absolute inset-x-0 top-0 -z-10 h-40 …`).
- If Tailwind cannot generate the `group-has-[…]/header` variant, fall back to a
  `data-overlay` attribute set by the flag on the header element via
  `closest("header")`, and say so in the report.

## Security requirements

None: presentation only, no data, session or route changes. The session-reading header parts
stay inside their existing `<Suspense>` boundaries.

## Acceptance criteria

- Home at the top of the page, at 375, 768, 1280 and 1920px: no white bar; the photo runs to
  the top of the window behind the logo, nav and buttons; logo and nav links are white and
  readable; no gap or white strip between header and hero.
- The visible hero below the bar is the same height as before; headline still lines up with the
  search card at 1920px.
- Scroll down a little: the bar turns solid white with the usual colours (green logo, grey nav,
  green active link), and stays that way while scrolled; scrolling back to the top clears it.
- Reloading the home page while scrolled down shows a solid bar.
- Every other page (`/properties`, a listing detail page, `/sign-in`, `/account`) shows the
  normal solid header at all scroll positions, including right after navigating away from home.
- The mobile drawer opened from the clear state looks exactly as today (white panel, dark text).
- No hydration warnings in the console.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (root layout component changed)

## Manual test steps (after implementation)

1. Restart `npm run dev` (root layout changes can leave the running dev server stale), open
   `http://localhost:3000/`.
2. At the top: the photo fills the area behind the navbar, logo and links are white.
3. Scroll down a little: the bar turns solid white with green logo. Scroll back up: clear again.
4. Click "Explore": the header is solid white on that page; click "Home": clear again.
5. Narrow to phone width: hamburger is white over the photo; open it, and the drawer is the usual
   white panel with dark text.
6. Signed in: the account pill stays readable over the photo.
