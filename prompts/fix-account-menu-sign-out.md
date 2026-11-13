# Fix: Sign out cut off in the desktop account menu

## Goal

Make **Sign out** in the desktop account dropdown always reachable, however many account links
the user has and however short the window is.

## References read

- `AGENTS.md` (compact design system rules: 44px menu items, `rounded-xl` popovers, no shadows,
  `border-line`; html font-size 90%).
- `prompts/ui-compact-design-system.md` (menu item and popover sizing).

## Existing code inspected

- `src/components/layout/AccountMenu.tsx`: the dropdown panel is
  `absolute right-0 top-full z-50 mt-2 w-56 … p-2`, inside the `sticky top-0 z-40` header
  (`SiteHeader.tsx`). It has no max height and no scrolling. Sign out is the last item.
- `src/components/layout/nav.ts` `accountLinks()`: up to 10 links for a lister who is also an
  admin (Overview, Messages, My listings, Verification, Subscription & billing, Agency, Saved
  properties, Listing profile, Settings, Admin console). Each is `min-h-control` (44px).
- `src/components/layout/MobileMenu.tsx`: the phone drawer is a full-height modal `<dialog>`
  that scrolls, so its Sign out can be reached. Not changed.
- No other fixed or high z-index element sits above the header (bottom bars are `z-30`,
  `lg:hidden`).

## Cause

For the owner's account (lister + agency + admin) the panel is about 510px tall and starts about
73px from the top of the viewport, so Sign out ends near 585px. Browser windows on laptops,
especially with Windows display scaling at 125–150%, are often shorter than that. Because the
panel lives in the sticky header, scrolling the page does not move it, and Sign out stays below
the bottom edge, unreachable.

## Decisions

1. The panel gets a max height of the viewport minus the header and a small gap:
   `max-h-[calc(100dvh-88px)]` (66px header + 8px offset + 14px breathing room; px because html
   is 90%).
2. Inside the panel, the link list scrolls (`min-h-0 overflow-y-auto overscroll-contain`) and the
   Sign out form stays pinned at the bottom (`shrink-0`), so Sign out is always visible without
   scrolling. A short window scrolls the links, never Sign out.
3. The flex layout goes on an inner wrapper, not the panel itself, because a `flex` class on an
   element with the `hidden` attribute would override `display: none` and show the closed menu.
4. Item sizes, colours, radius and order stay as they are (44px touch targets kept).
5. Mobile drawer unchanged.

## Files likely to change

- `src/components/layout/AccountMenu.tsx`
- `e2e/a11y.spec.ts` or a new small `e2e/account-menu.spec.ts` (see checks)

## Implementation requirements

- Panel: keep `id`, `hidden`, positioning, border, radius, width, `p-2`; add the max height and
  an inner `flex h-full max-h-[inherit] flex-col` wrapper (or put max-h on the wrapper), with the
  `<ul>` scrolling and the `<form>` not shrinking.
- Keep Esc, outside click and route-change closing as they are.
- No new dependencies, no shadows, no new tokens.

## Security requirements

None beyond the existing ones: Sign out stays the same Server Action form.

## Acceptance criteria

- Signed in as a user with all 10 links, at 1280 × 560 and 1024 × 420, opening the menu shows
  Sign out fully inside the viewport, and clicking it signs out.
- At tall windows the menu looks exactly as before (no scrollbar, same spacing).
- With the menu closed, the panel is not displayed.
- Esc and outside click still close the menu.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm test`.
- Browser check (Edge via playwright-core against `npm run dev`, signed in as a dev account):
  screenshot the open menu at 1280 × 900 (unchanged look) and 1024 × 420 (Sign out visible,
  links scroll), and assert the Sign out button's bounding box is inside the viewport.
- `npm run build` is not needed (one client component, no route or config change).

## Manual test steps

1. Sign in on the live site (after deploy) or `npm run dev`.
2. Make the browser window short (or zoom to 150%), open the account menu by your name.
3. Sign out is visible at the bottom of the menu; the links above scroll if they don't fit.
4. Click Sign out: you land signed out.
5. In a normal-sized window the menu looks as it did before.
