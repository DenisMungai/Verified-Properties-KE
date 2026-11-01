# UI: home hero photo and sign-in photo

## Goal

Replace the two placeholder house illustrations with the user's photos:

1. **Home hero**: the exterior photo (stone-and-glass house at golden hour) fills the entire hero
   background, edge to edge, with the headline, text and button on top of it.
2. **Sign-in page**: the interior photo (sunlit living room) fills the left story panel of the
   auth layout, replacing the drawn house.

## References read

- `AGENTS.md` design rules (colour tokens, six font sizes, radii, home hero full-bleed with square
  corners, no navy, no drop shadows)
- `prompts/home-hero-full-bleed.md` (current hero layout, text alignment with the page below)
- `prompts/ui-compact-design-system.md` (hero `min-h-[400px] sm:min-h-[520px]`)
- `node_modules/next/dist/docs/01-app/03-api-reference/02-components/image.md`: static imports get
  width, height and `blurDataURL` automatically; `fill` needs a positioned parent; `priority` is
  deprecated in Next 16, use `preload`; `sizes` on `fill` images

## Existing code inspected

- `src/app/page.tsx`: hero `<section>` is a 2-column grid (`lg:grid-cols-[52fr_48fr]`), white left
  column with eyebrow chip, H1 (`text-ink`), body (`text-slate-600`) and primary button; right
  column is a mint panel with a drawn house, `lg` only
- `src/components/auth/AuthShell.tsx`: shared by sign-in, sign-up, forgot-password,
  reset-password and check-email. Left `aside` (`lg` only) is `bg-emerald-700` with brand name,
  display headline, body, a drawn `HouseIllustration` and three check points; right side is the form
- `src/components/listings/ListingImage.tsx`, `src/components/ui/Avatar.tsx`: existing `next/image`
  use with `preload`
- `next.config.ts`: no `images` config, so the default optimiser serves static imports
- `tailwind.config.ts`: `ink` #17231D (hex, so opacity modifiers like `from-ink/80` work)
- Photos: `1.jpg` 1536×1024 (≈450 KB), `2.jpg` 1024×1280 portrait (≈225 KB)

## Decisions and assumptions

1. **Asset location**: copy the photos into `src/assets/images/` as `home-hero.jpg` and
   `auth-living-room.jpg` and import them statically, so Next gets their size, generates a blur
   placeholder and serves resized WebP/AVIF. (Not `public/`: that loses the automatic blur and
   dimensions.)
2. **Hero is one full-bleed photo panel.** The two-column grid and mint illustration go away. The
   photo covers the whole hero at every width (`fill`, `object-cover`), under the header, square
   corners, `border-b border-line` kept. Height unchanged: `min-h-[400px] sm:min-h-[520px]`.
3. **Readable text over the photo** with a Charcoal (`ink`) overlay, no new colours:
   - phones/tablets: an even `bg-ink/55` wash (text spans most of the width there);
   - `lg`+: a left-to-right gradient `from-ink/80 via-ink/45 to-transparent`, so the left (text)
     side is dark and the house on the right stays bright.
   White headline and body text target ≥4.5:1 on the darkened area.
4. **Focal point**: the house sits centre-right in the photo. Use `object-[70%_center]` on small
   screens so the house, not just the tree, stays in frame; `lg:object-center` on wide screens.
5. **Hero text**: same copy and alignment as now (left padding still lines up with the search card
   below past 1440px). Colours change for the dark background: H1 `text-white`, body
   `text-white/90`, eyebrow chip stays `bg-mint-50 text-emerald-700`, button stays the primary
   (Forest) button. Text column capped at `max-w-xl` so it stays on the dark side.
6. **Hero photo is decorative** (`alt=""`): the H1 carries the meaning. It is the largest thing
   above the fold, so it gets `preload` and `sizes="100vw"`, plus `placeholder="blur"`.
7. **Auth panel photo applies to every auth page.** `AuthShell` is shared, so sign-in, sign-up,
   forgot/reset password and check-email all get the same photo panel. Keeps the auth screens
   consistent; tell me if you want it on sign-in only.
8. **Auth panel layout**: the photo fills the whole left `aside` (`lg` only, as now; below `lg`
   the form stands alone). The drawn `HouseIllustration` is deleted. Brand name stays at the top;
   headline, body and the three check points move to the bottom of the panel over a
   `bg-gradient-to-t from-ink/85 via-ink/40 to-ink/10` overlay so the white text stays readable
   and the room stays visible in the upper part. The `bg-emerald-700` stays as the colour shown
   while the photo loads. Photo `alt=""`, `sizes="(min-width: 1024px) 48vw, 0px"`, `preload` (it
   is the main visual on those pages at `lg`), `placeholder="blur"`, `object-cover object-center`.
9. **No radius, no shadow** on either photo; they fill their panels edge to edge.

## Files likely to change

- `src/assets/images/home-hero.jpg` (new, from the user's first upload)
- `src/assets/images/auth-living-room.jpg` (new, from the user's second upload)
- `src/app/page.tsx` (hero markup)
- `src/components/auth/AuthShell.tsx` (photo panel, remove `HouseIllustration`)

## Implementation requirements

### Home hero (`src/app/page.tsx`)

- Section: `relative isolate flex min-h-[400px] w-full items-center overflow-hidden border-b
  border-line bg-ink sm:min-h-[520px]` (`bg-ink` shows while the photo loads).
- First child: `<Image src={heroImage} alt="" fill preload placeholder="blur" sizes="100vw"
  className="-z-20 object-cover object-[70%_center] lg:object-center" />`.
- Second child: overlay `<div aria-hidden="true" className="absolute inset-0 -z-10 bg-ink/55
  lg:bg-transparent lg:bg-gradient-to-r lg:from-ink/80 lg:via-ink/45 lg:to-transparent" />`.
- Text block keeps today's padding classes (`px-4 py-10 sm:px-5 sm:py-14 md:px-page-x lg:py-16
  lg:pl-[max(4vw,calc(50vw-720px+4vw))] lg:pr-12`), adds `max-w-xl`-style cap on the content
  (wrap the content or cap the H1/body, without breaking the left alignment).
- Copy, eyebrow, H1 sizes, button and link target unchanged; only text colours change per
  decision 5.
- Delete the mint illustration column.

### Auth shell (`src/components/auth/AuthShell.tsx`)

- Remove `HouseIllustration`.
- `aside`: `relative isolate hidden flex-col justify-between gap-6 overflow-hidden bg-emerald-700
  px-10 py-12 text-white lg:flex`.
- Children in order: `<Image … fill … className="-z-20 object-cover object-center" />`, overlay
  `<div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/85
  via-ink/40 to-ink/10" />`, brand name (top), then a bottom group with headline, body and the
  check-point list (same copy and type sizes as now).
- Form side unchanged.

## Security requirements

None beyond the usual: static images only, no user data, nothing new reaches the browser except
the optimised photos.

## Acceptance criteria

- Home at 375, 768, 1280, 1440 and 1920px: the photo covers the whole hero edge to edge under the
  header, no gaps, no horizontal scroll; the house stays visible; headline, text and button are
  readable (white text over the dark side); headline still lines up with the search card at 1920px.
- Hero image shows a blur placeholder, then the sharp photo; network panel shows an optimised
  `/_next/image?...` request, not the raw 450 KB JPEG.
- Sign-in at ≥1024px: left panel is the living-room photo filling the full panel height; brand at
  the top, headline, text and check points readable at the bottom. No drawn house anywhere.
- Below 1024px the sign-in page shows the form only, as before.
- Sign-up, forgot-password, reset-password and check-email show the same photo panel.
- No console warnings from `next/image` (missing `sizes`, deprecated `priority`, LCP warnings).

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (new static assets and image optimisation)

## Manual test steps (after implementation)

1. `npm run dev`, open `http://localhost:3000/`.
2. The house photo fills the whole hero under the header; text and button sit on the darker left
   side and read clearly. Resize from phone width to a wide window: the photo always covers the
   hero and the house stays in frame.
3. DevTools → Network → Img: the hero loads through `/_next/image` as WebP/AVIF.
4. Open `http://localhost:3000/sign-in` at a desktop width: the living-room photo fills the left
   panel, brand name on top, headline and check points readable at the bottom.
5. Narrow below 1024px: the panel hides and the form stands alone.
6. Visit `/sign-up` and `/forgot-password`: same photo panel.
