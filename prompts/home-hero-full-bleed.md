# Home: full-bleed hero

## Goal

Make the home page hero touch the edges of the screen: full window width, flush under the header,
no rounded corners and no side borders. The text inside stays lined up with the rest of the page.

## References read

- `AGENTS.md` design rules (radii, `PageContainer` 1440px, `page-x` 4vw)
- `prompts/ui-compact-design-system.md` decision 12 (hero `rounded-xl border`, `min-h-[400px] sm:min-h-[520px]`)

## Existing code inspected

- `src/app/page.tsx`: hero `<section>` inside `PageContainer` (`pt-6`), `rounded-xl border border-line
  bg-white`, grid `lg:grid-cols-[52fr_48fr]`, left text block `p-7 sm:p-10 lg:p-12`, right mint
  illustration (lg only); `HomeSearch` card right under it (`gap-4`)
- `src/components/layout/PageContainer.tsx` (`px-4 sm:px-5 md:px-page-x`, `max-w-page`)
- `tailwind.config.ts` (`page-x` = 4vw, `max-w-page` = 1440px)

## Decisions and assumptions

1. **Edge to edge at every width**, phones included: the hero moves out of `PageContainer`, so it
   spans the full window and sits directly under the header (no top gap). Square corners, no side
   or top border; a 1px `border-b border-line` separates it from the page below.
2. **Text stays aligned with the page.** The left column's padding matches `PageContainer`'s side
   padding, and above 1440px it grows so the headline lines up with the search card and sections
   below: `lg:pl-[max(4vw,calc(50vw-720px+4vw))]`.
3. **The mint illustration panel runs to the right edge** of the screen on `lg`+ (it already fills
   its column; the column now ends at the window edge).
4. **Everything below stays in the 1440px container**: the search card, locations and listings,
   with the search card `pt-6` below the hero (it was `gap-4` under the card).
5. Height unchanged: `min-h-[400px] sm:min-h-[520px]`.

## Files likely to change

- `src/app/page.tsx` (hero placement and classes)
- `AGENTS.md` (radius note: home hero is full-bleed, not `rounded-xl`)

## Implementation requirements

- `HomePage` returns a fragment: the hero `<section>` first, then the existing `PageContainer`
  (`flex flex-col gap-16 pb-8 pt-6`) with `HomeSearch` as its first child, then locations, then
  listings. `HomeSearch` keeps its own wrapper; the old `gap-4` group goes away.
- Hero `<section>`: `grid min-h-[400px] w-full border-b border-line bg-white sm:min-h-[520px]
  lg:grid-cols-[52fr_48fr]` (no `rounded-xl`, no `border`, no `overflow-hidden` needed).
- Left column: vertical `py-10 sm:py-14 lg:py-16`, horizontal `px-4 sm:px-5 md:px-page-x`, and from
  `lg` `pr-12` plus the left padding in decision 2. Content unchanged (eyebrow, H1, text, button).
- Right column unchanged apart from losing the card corners.

## Security requirements

None: layout only.

## Acceptance criteria

- At 375, 768, 1280, 1440 and 1920px the hero's white and mint areas reach both window edges and
  start right under the header; no rounded corners; no horizontal scrollbar.
- At 1920px the hero headline's left edge lines up with the search card's left edge below (within
  a few pixels; Windows scrollbars can shift `vw` slightly).
- Search card, locations and listings look and sit as before.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm run build`

## Manual test steps (after implementation)

1. `npm run dev`, open `http://localhost:3000/`.
2. The hero fills the full width under the header, square corners, mint panel to the right edge.
3. Widen the window past 1440px: the headline stays lined up with the search card below.
4. Narrow to phone width: the hero still spans edge to edge, text padded as before.
