# UI: living-room photo in the sign-in story panel

## Goal

Replace the placeholder house illustration (Forest block with a mint house and green door) in the
sign-in page's left story panel with the user's photo: a sunlit Nairobi apartment living room
(cream sectional, round wooden coffee table, jute rug, city view through glass doors).

## References read

- `AGENTS.md` design rules (radii, no shadows, tokens)
- `prompts/deploy-vercel-signin-design.md` (design 04 split layout, panel shown from `lg`)
- `src/app/page.tsx` home hero (static `next/image` import with `placeholder="blur"`)

## Existing code inspected

- `src/components/auth/AuthShell.tsx`: `HouseIllustration` (decorative, `aria-hidden`,
  `aspect-[550/290]`, `rounded-lg bg-emerald-600`) between the headline block and the check-point
  row. The story panel is `hidden … lg:flex`.
- `AuthShell` is shared by `/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password` and
  `/check-email`.
- Source image: 1024×1280 JPEG, 230 KB, supplied in this conversation.

## Decisions

- **The photo replaces the illustration in `AuthShell`**, so all five auth pages show it (they
  share the panel; one look across sign-in / sign-up keeps the flow consistent).
- **File:** `src/assets/images/auth-living-room.jpg` (copied as supplied), statically imported so
  Next optimises it, sizes it and generates the blur placeholder.
- **Crop:** `aspect-[4/3]` with `object-cover object-center` (the portrait photo is cropped to the
  sofa, coffee table and window view). Taller than the old 550:290 slot so the room reads, still
  short enough for the panel on a 1280×800 screen; if the panel overflows a 1280×800 viewport,
  use `aspect-[16/10]` instead.
- `rounded-lg`, no border or shadow, `alt=""` (decorative, as the illustration was).
- `sizes="(min-width: 1280px) 34rem, 45vw"`; not preloaded (below the headline, desktop only).
- Phones and tablets are unchanged: the panel stays hidden below `lg`.

## Files likely to change

- `src/assets/images/auth-living-room.jpg` (new)
- `src/components/auth/AuthShell.tsx`: remove `HouseIllustration`, render the photo

## Implementation requirements

1. Copy the supplied image to `src/assets/images/auth-living-room.jpg`.
2. In `AuthShell`, replace `<HouseIllustration />` with a `relative aspect-[4/3] w-full overflow-hidden
   rounded-lg bg-emerald-600` wrapper holding `next/image` (`fill`, `placeholder="blur"`,
   `alt=""`, `sizes` as above, `object-cover object-center`). Delete the unused illustration and
   update the component comment.
3. No other layout, copy or colour changes.

## Security requirements

Static asset only; no data, auth or route changes.

## Acceptance criteria

- `/sign-in` at 1280×800 and 1440×900: the left panel shows the living-room photo with rounded
  corners where the house illustration was; headline above and check-point row below unchanged;
  no horizontal scroll.
- The image is served through `/_next/image` (optimised), with a blur placeholder while loading.
- `/sign-up` shows the same photo; below 1024px no panel or photo appears.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, then screenshots of `/sign-in`
and `/sign-up` at 390, 1280×800 and 1440×900 against `npx next start -p 3005`.

## Manual test steps

1. Restart `npm run dev`, open http://localhost:3000/sign-in on a desktop-width window.
2. The left green panel shows the living-room photo under "Your next chapter starts with a place."
3. Open `/sign-up`: same photo.
4. Narrow the window below 1024px: the panel and photo disappear; the form is unchanged.
