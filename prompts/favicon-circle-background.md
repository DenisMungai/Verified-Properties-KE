# Favicon: circular white background

## Goal

Change the white background behind the favicon art from a rounded square to a circle.

## References read

- `AGENTS.md`
- `prompts/favicon-white-background.md`, `prompts/favicon-svg-detailed.md`

## Existing code inspected

- `src/app/icon.svg` — 1024 viewBox, `<rect rx="192">` white tile + traced art (94f40a8).
- `src/app/favicon.ico` (16/32/48/64/128/256), `public/android-chrome-192x192.png`,
  `public/android-chrome-512x512.png` — art on a white rounded tile (537be45).
- `src/app/apple-icon.png` — full white square, no alpha.
- Art extent in the 1024 box: about x 143–880, y 240–785. Its furthest point from the centre is
  about 390px, inside a 512px-radius circle, so the art fits without scaling.

## Decisions and assumptions

1. **Circle fills the canvas**: `<circle cx="512" cy="512" r="512">` in the SVG; rasters get a white
   circle the full width of each size, transparent outside it. Art stays the same size and position.
2. **Apple icon stays a full white square.** iOS applies its own rounded mask and paints
   transparent pixels black, so a circle there would show black corners on the home screen.
3. Raster source is still the supplied art from the original commit `0008a7e` (transparent
   background), composited onto the circle at each size; the `.ico` keeps its 6 PNG entries.
   Throwaway script in the scratchpad, not committed.
4. **Going live**: commit only the icon files and this prompt on the current branch, then fast-forward
   `main` (Vercel builds `main` only). S22 work stays uncommitted.

## Files likely to change

- `src/app/icon.svg`
- `src/app/favicon.ico`
- `public/android-chrome-192x192.png`, `public/android-chrome-512x512.png`

## Implementation requirements

- `icon.svg`: replace the `<rect … rx="192">` with `<circle cx="512" cy="512" r="512" fill="#FFFFFF"/>`.
- Rasters: white circle mask at each size, art composited on top.

## Security requirements

None beyond normal: no dependencies, no secrets.

## Acceptance criteria

- Tab icon, `.ico` and Android icons show the logo on a white circle with transparent corners.
- No part of the art is clipped by the circle at 16, 32 and 256 px.
- `apple-icon.png` unchanged.
- Live site serves the new `icon.svg` and `favicon.ico` (byte-for-byte equal to the commit).

## Checks to run

- `npm run typecheck`, `npm run lint`.
- Render previews on dark and light backgrounds; check corner pixels are transparent.
- After push: compare live `/icon.svg` and `/favicon.ico` with the committed files.

## Manual test steps

1. Open the site in a private window on desktop Chrome/Edge: the tab icon is the logo on a white
   circle (try a dark browser theme too).
2. Open `https://verifiedpropertieske.vercel.app/icon.svg` and `/android-chrome-512x512.png`.
