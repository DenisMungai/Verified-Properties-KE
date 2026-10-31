# UI — Sticky account and admin side menu

## Goal

On desktop, the left side menu in the lister account area (Overview, My listings, Inquiries,
Subscription & billing, Saved properties, Listing profile, Settings) scrolls away with the page.
On long pages, for example **My listings → edit → Photos** with many uploaded photos, the menu
disappears while the lister scrolls through the photos. Make the menu stay in view (float)
while the page scrolls, on **every** page that uses this menu. Apply the same behaviour to the
admin console menu, which uses the same layout.

## References read

- `AGENTS.md` (workflow, compact design rules: sticky 66px header, 44px targets).
- `prompts/ui-compact-design-system.md` (layout shell: header `min-h-[66px]` sticky `z-40`,
  account/admin sidebar `17.5rem`).

## Existing code inspected

- `src/app/account/layout.tsx`: `PageContainer` grid `lg:grid-cols-[theme(spacing.sidebar)_minmax(0,1fr)]`;
  the menu sits in `<aside className="min-w-0 print:hidden">`. As a grid item it stretches to
  the full height of the row and has no sticky positioning, so it scrolls with the content.
- `src/app/admin/layout.tsx`: same grid and `<aside className="min-w-0">`.
- `src/components/account/AccountNav.tsx`, `src/components/admin/AdminNav.tsx`: below `lg`
  they render a horizontal, scrollable tab row above the content; from `lg` a vertical list.
- `src/components/layout/SiteHeader.tsx`: sticky header, 66px tall, `z-40`.
- No ancestor of the aside sets `overflow` (root layout, `main`, `PageContainer`), so
  `position: sticky` works.

## Decisions and assumptions

1. **Desktop only (`lg` and up)**, where the menu is a left column. Below `lg` the menu is a
   short horizontal tab row at the top of the page; it stays as it is (making it sticky there
   would cover content on small screens). Tell the user if they want the mobile tab row sticky
   too.
2. The aside becomes `lg:sticky lg:top-[82px] lg:self-start`: it stays 16px below the 66px
   sticky header. `self-start` stops the grid stretching it, which would otherwise stop
   sticky positioning from working.
3. If the menu is ever taller than the window (short laptop screens, admin links added later),
   it scrolls on its own: `lg:max-h-[calc(100dvh-98px)] lg:overflow-y-auto`. The current menu
   (at most 8 × 44px items) fits on normal screens, so normally nothing changes.
4. Same change in the admin layout. The right-hand tips panel in the listing editor is not part
   of this request and stays unchanged.
5. Print stays unchanged (`print:hidden` on the account aside).

## Files likely to change

- `src/app/account/layout.tsx`
- `src/app/admin/layout.tsx`

## Implementation requirements

- Add the sticky classes from decisions 2 and 3 to both `<aside>` elements. No other markup,
  data or behaviour changes.
- Keep the comment on the account aside accurate.

## Security requirements

None affected: class names only, no data, auth or route changes.

## Acceptance criteria

- At ≥1024px wide, on every account page (and every admin page), scrolling the page keeps the
  side menu visible just below the header; the active item stays highlighted.
- On the Photos step with many photos, the menu stays in view while scrolling through them.
- Below 1024px the menu tab row behaves exactly as before.
- No horizontal overflow; the header still sits above the menu.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.

## Manual test steps (after implementation)

1. Restart `npm run dev`, sign in as a lister, browser window ≥1024px wide.
2. Go to **My listings → Edit** on a listing → **Photos**, upload enough photos to make the page
   scroll. Scroll down and up: the left menu stays in view below the header.
3. Visit Overview, Inquiries, Subscription & billing, Saved properties, Listing profile and
   Settings; scroll each long page and confirm the menu stays put.
4. As an admin, open `/admin/listings` and `/admin/reports`; the admin menu stays put too.
5. Narrow the window below 1024px: the menu is the horizontal tab row at the top, as before.
