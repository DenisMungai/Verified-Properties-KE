# Favicon: white background

## Goal

The favicon is dark green (`#064B2B`) art on a transparent background, so it nearly disappears on
dark browser tab bars. Put the art on a white background in every icon file so it is visible
everywhere.

## References read

- `AGENTS.md`
- `prompts/favicon-icons.md` (decision 6 flagged this low-contrast issue as out of scope)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`

## Existing code inspected

- `src/app/icon.svg` — 512×512 viewBox, art spans roughly x 72–440, y 82–408, no background.
- `src/app/favicon.ico` — 6 embedded PNGs: 16, 32, 48, 64, 128, 256 px, transparent.
- `src/app/apple-icon.png` (180×180), `public/android-chrome-192x192.png`,
  `public/android-chrome-512x512.png` — RGBA, transparent.
- `src/app/manifest.ts` — unchanged (icon paths stay the same).
- `sharp` is already a dependency.

## Decisions and assumptions

1. **Shape**: `icon.svg`, `favicon.ico` and the Android PNGs get a white rounded square filling the
   whole canvas (`rx` = 96 on 512, ≈ 19%), so the icon reads as a tile in tabs and launchers.
2. **Apple icon**: a full white square with no rounding and no transparency — iOS applies its own
   corner mask and fills transparent pixels with black.
3. **Art unchanged**: same paths, same `#064B2B`, same position. The art already has ~70px margin
   on a 512 canvas, so no rescaling.
4. **Raster source = the supplied PNGs, not the SVG** (changed during implementation): the
   supplied PNG/ICO art (chimney, window, swoosh check) is more detailed than `icon.svg`, so
   rendering rasters from the SVG would downgrade them. Each original raster (from git `HEAD`) is
   composited onto a white tile at its own size; each of the 6 original ICO entries is processed
   the same way and the `.ico` rebuilt. The generator is a throwaway script in the scratchpad,
   not committed.
5. Also drop the invalid `rx="8"` attribute on the `<path>` in `icon.svg` (has no effect on a path).

## Files likely to change

- `src/app/icon.svg`
- `src/app/favicon.ico`
- `src/app/apple-icon.png`
- `public/android-chrome-192x192.png`, `public/android-chrome-512x512.png`

## Implementation requirements

- Add `<rect width="512" height="512" rx="96" fill="#FFFFFF"/>` as the first child of `icon.svg`.
- Render PNGs from that SVG at 16/32/48/64/128/256 (ICO), 192, 512 (Android).
- Apple icon: render at 180 and flatten onto `#FFFFFF` with a square (unrounded) background.
- Write the `.ico` as a PNG-embedded ICO (6 entries), same as today.

## Security requirements

None beyond normal: no new dependencies, no network calls, nothing committed outside the files above.

## Acceptance criteria

- Every icon file shows the green house + check on white.
- `apple-icon.png` has no transparent pixels.
- `favicon.ico` still holds 16, 32, 48, 64, 128 and 256 px entries.
- `/icon.svg`, `/favicon.ico`, `/apple-icon.png`, `/manifest.webmanifest` still resolve.

## Checks to run

- `npm run typecheck`, `npm run lint` (no TS changes expected, run anyway).
- Script check: read back each PNG's size and alpha, and the ICO directory.

## Manual test steps

1. `npm run dev`, open `http://localhost:3000`.
2. Hard-refresh (browsers cache favicons aggressively; an incognito window is easiest).
3. Switch the browser to a dark theme: the tab icon should be a white tile with the green logo.
4. Open `/icon.svg`, `/favicon.ico`, `/apple-icon.png` and `/android-chrome-512x512.png` directly.
5. On the phone, after deploy: "Add to Home Screen" shows the logo on white.
