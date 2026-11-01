# UI: auth pages with a full-page photo and clear header

## Goal

Give the sign-in page the same treatment as the home page: the living-room photo covers the
whole page, running up behind a clear (transparent) navbar, and the form sits in a white card on
top. The navbar turns solid white again once the visitor scrolls. `AuthShell` is shared, so
sign-up, forgot password, reset password and check email get the same layout.

## References read

- `AGENTS.md` design rules (panels `rounded-lg`, panel padding `p-5`/`p-6`, 1px `border-line`,
  no drop shadows, colour tokens, six font sizes, readable contrast)
- `prompts/ui-clear-header-over-hero.md` (`HeaderOverlayFlag`, `has-[[data-header-overlay]]`
  variants, 67px slide-up behind the header)
- `prompts/ui-hero-auth-photos.md` (auth photo, charcoal overlays)
- User choice (2026-11-01): **full-page photo** layout, form in a white card on the right

## Existing code inspected

- `src/components/auth/AuthShell.tsx`: grid `min-h-[calc(100dvh-66px)]`, `lg` 2 columns:
  photo `aside` (brand name, display headline, body, 3 check points) and the form on
  `bg-canvas` (`max-w-[28rem]`, H1 `text-display-sm`, subtitle, children)
- Users: `src/app/(auth)/{sign-in,sign-up,forgot-password,reset-password,check-email}/page.tsx`
- `src/components/layout/HeaderOverlayFlag.tsx`: clear only when `pathname === "/"` and at top
- `src/components/layout/PageContainer.tsx` (`max-w-page`, side padding)
- Photo: `src/assets/images/auth-living-room.jpg`, 1024×1280 portrait

## Decisions and assumptions

1. **The photo covers the whole auth page at every width**, starting at the top of the window
   behind the header (`-mt-[67px] pt-[67px]`, `min-h-dvh`), `object-cover object-center`,
   `sizes="100vw"`, `preload`, `placeholder="blur"`, `alt=""`. Deep green (`bg-emerald-700`)
   shows while it loads. The photo is 1024px wide, so wide screens scale it up a little; the
   overlay below hides most of the softness. A wider original would look sharper later.
2. **Overlays** (charcoal, same recipe as home): `bg-ink/55` below `lg`; from `lg` a
   left-to-right `from-ink/80 via-ink/50 to-ink/30` so the story text on the left reads clearly;
   plus the same top fade (`h-40 from-ink/60`) for the navbar links.
3. **Layout** inside `PageContainer` (lines up with the header):
   - `lg`+: two columns, story on the left, form card on the right
     (`lg:grid-cols-[minmax(0,1fr)_28rem]`, `gap-12`), both vertically centred, `py-12`.
   - below `lg`: the form card alone, centred, `py-8`; the story is hidden as today.
4. **Story column**: display headline, body and the three check points in white (same copy as
   now). The panel's own "VerifiedPropertiesKE" line is dropped: the white header logo is now
   directly above it on the same photo, so it would repeat.
5. **Form card**: `rounded-lg border border-line bg-white p-5 sm:p-6`, full width up to 28rem,
   holding the existing H1 (`text-display-sm`), subtitle (`text-slate-600`) and form. No shadow.
6. **Clear header on auth pages**: `HeaderOverlayFlag` treats the five auth paths like `/`
   (clear at the top, solid after scrolling 16px). The paths live in one exported constant
   (`CLEAR_HEADER_PATHS`) so the list is in one place.

## Files likely to change

- `src/components/auth/AuthShell.tsx`
- `src/components/layout/HeaderOverlayFlag.tsx`

## Implementation requirements

- `HeaderOverlayFlag`: replace `pathname !== "/"` with a check against
  `CLEAR_HEADER_PATHS = new Set(["/", "/sign-in", "/sign-up", "/forgot-password",
  "/reset-password", "/check-email"])`; update its doc comment.
- `AuthShell`: outer `<div className="relative isolate -mt-[67px] flex min-h-dvh items-center
  overflow-hidden bg-emerald-700 pt-[67px]">` containing, in order, the `Image` (`-z-20`), the
  two `aria-hidden` overlay layers (`-z-10`), and a `PageContainer` with the grid from decision 3.
  Story column `hidden lg:flex flex-col gap-6`; form card per decision 5. Keep `title`,
  `subtitle`, `children` props and the H1 unchanged so the five pages need no edits.
- Update the component's doc comment (design "04 — Sign In", now full-page photo).

## Security requirements

None: presentation only. Forms, Server Actions, session reads and redirects are untouched.

## Acceptance criteria

- `/sign-in` at 375, 768, 1280, 1440 and 1920px: the photo fills the whole page behind a clear
  header (white logo and links), no white strip at the top, no horizontal scroll; the form card
  is white, readable and fully usable; from 1024px the story text sits on the left over the
  darker side of the photo.
- Scrolling (e.g. the longer sign-up form on a phone) turns the header solid; back at the top it
  clears.
- `/sign-up`, `/forgot-password`, `/reset-password`, `/check-email` show the same layout.
- Signing in still works and redirects as before; field errors still show inside the card.
- Home behaves as before; `/properties` and other pages keep the solid header.
- No console errors or hydration warnings.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`

## Manual test steps (after implementation)

1. Restart `npm run dev` and open `http://localhost:3000/sign-in`.
2. The photo covers the whole page, the navbar is clear with white text, the form is in a white
   card on the right, and the story text is on the left.
3. Sign in with a test account: it redirects as before.
4. Open `/sign-up` at phone width: the photo sits behind the form card; scroll down and the
   header turns solid, scroll up and it clears.
5. Check `/forgot-password`, and that `/properties` still has the solid white header.
