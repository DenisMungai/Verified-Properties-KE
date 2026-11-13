# UI: more popular locations on the home page

## Goal

The home page "Explore popular locations" section shows only 4 counties (Nairobi, Kiambu,
Mombasa, Nakuru), leaving most of the row empty on desktop. Add Kenya's major cities and towns so
the row is always full, at every width, with no half-cut tile and no hidden sideways scroll for
mouse users.

## References read

- `AGENTS.md` (compact type tokens, 44px targets, colours, radii)
- `prompts/ui-mobile-optimization.md` (problem 5: the rail clipped on phones, which is why phones
  got a 2×2 grid)

## Existing code inspected

- `src/components/search/LocationTiles.tsx`: `LOCATIONS` array of `{ county, note }`; phones are a
  2-column grid of compact rows; from `sm` a horizontal snap rail (`overflow-x-auto
  hide-scrollbar`) of 80px icon circles, tile `w-28`, gap `gap-6`; each tile links to
  `searchHref({ q: county })`.
- `src/app/page.tsx`: section heading "Explore popular locations", subtext "Start with a county you
  love."
- `src/db/queries/public-listings.ts`: `q` matches county **or town or neighbourhood**
  (`ilike`), so town names like Eldoret or Kitengela search correctly.
- `PageContainer`: 1440px max, `px-4` / `sm:px-5` / `md:px-[4vw]`.

## Width maths (90% root: tile 100.8px, gap 21.6px, so n tiles need 122.4n − 21.6px)

| Breakpoint | Content width (at breakpoint start) | Tiles that fit |
| ---------- | ----------------------------------- | -------------- |
| lg 1024    | ≈ 942px                             | 7              |
| xl 1280    | ≈ 1178px                            | 9              |
| 2xl 1536+  | ≈ 1317px (1440 cap)                 | 10             |

## Decisions and assumptions

- **14 locations, ordered by size/importance**, each with a short factual note:
  1. Nairobi, Apartments & homes
  2. Mombasa, Coastal living
  3. Kisumu, Lakeside city
  4. Nakuru, Space to grow
  5. Eldoret, Highland city
  6. Kiambu, Family homes
  7. Thika, Commuter town
  8. Machakos, Near the capital
  9. Nyeri, Central highlands
  10. Kitengela, Growing suburb
  11. Naivasha, Lake and leisure
  12. Malindi, Coastal town
  13. Meru, Mt Kenya east
  14. Nanyuki, Mt Kenya views
- **Desktop (lg+): one full row, no scroll.** The rail stops scrolling and spreads its tiles
  evenly across the row (`justify-between`). It shows the first 7 tiles at `lg`, 9 at `xl` and
  10 at `2xl`, so the row is full and nothing is cut. The rest are `display: none` (not
  focusable), not just clipped.
- **Tablets (sm–lg): the existing snap rail** with all 14 tiles, so the row is full and overflows
  for touch scrolling, as today.
- **Phones (< sm): the existing 2-column grid, first 6** (3 rows), so the section doesn't turn
  into a 7-row list above the listings.
- Subtext changes to "Start with a city or town you love." (the list is no longer only counties).
- Tiles link to a search even if a town has no listings yet; search already shows its empty
  state. No counts are shown, so nothing about availability is implied.
- Field `county` is renamed `name` (it now holds towns too).

## Files likely to change

- `src/components/search/LocationTiles.tsx`
- `src/app/page.tsx` (subtext only)

## Implementation requirements

- Visibility per item from its index, via a small helper returning classes:
  index ≥ 6 → `max-sm:hidden`; index ≥ 7 → `lg:max-xl:hidden`; index ≥ 9 → `xl:max-2xl:hidden`;
  index ≥ 10 → `2xl:hidden`. Use the `cn` helper; keep class strings literal so Tailwind sees them.
- List: add `lg:justify-between lg:overflow-visible` (snap and scroll stay for sm–lg). Keep the
  tile markup, sizes, colours and hover as they are.
- Update the component doc comment to describe the three layouts.

## Security requirements

None: static links to the public search.

## Acceptance criteria

- 390px: 6 locations in a 2×2-style grid (3 rows), no sideways scroll.
- 768px: a full rail that scrolls sideways (14 tiles).
- 1024, 1280, 1440 and 1920px: one row filled edge to edge (7 / 9 / 10 / 10 tiles), evenly
  spaced, no tile cut off, no horizontal scrolling.
- Clicking "Eldoret" opens `/properties?q=Eldoret`.
- The page has no horizontal overflow at any of those widths.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`
- Edge (playwright-core) on a local production build at 390, 768, 1024, 1280, 1440 and 1920px:
  count visible tiles, assert the last visible tile ends inside the list box and the list has no
  scroll at lg+, and take screenshots of the section.

## Manual test steps

1. `npm run dev`, open `http://localhost:3000`.
2. Desktop: the "Explore popular locations" row is full from left to right, evenly spaced.
   Resize the window: tiles drop off the end as it narrows; the row stays full.
3. Below about 1024px wide: the row becomes a sideways-swipe rail with all 14 locations.
4. Phone width: 6 locations in two columns.
5. Click a town (e.g. Kisumu): the search opens with that location filled in.
