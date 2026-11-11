# Favicon: detailed artwork in icon.svg

## Goal

Desktop browsers (Chrome, Edge, Firefox) prefer `src/app/icon.svg` for the tab icon. That SVG is a
rough approximation of the logo (no chimney or window, the check merges into a filled block),
while the PNG/ICO files carry the detailed supplied art. Replace `icon.svg` with a vector of the
detailed art, on the same white rounded tile, so every icon matches.

## References read

- `AGENTS.md`
- `prompts/favicon-icons.md`, `prompts/favicon-white-background.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`

## Existing code inspected

- `src/app/icon.svg` — hand-drawn strokes, 512 viewBox, white `rx=96` tile (commit 537be45).
- `../verified-properties-ke-favicon-package/` — no detailed vector source; its `favicon.svg` is the
  same rough version. Best source is `android-chrome-512x512.png` (single colour `#064B2B` on
  transparent).
- Raster icons (`favicon.ico`, `apple-icon.png`, Android PNGs) — already detailed art on white;
  unchanged.

## Decisions and assumptions

1. **Trace the 512px PNG to vector** with `potrace` (installed only in the scratchpad, not a project
   dependency): upscale to 1024 with Lanczos, flatten onto white, threshold 160, drop specks under
   20px. Output is one evenodd `<path>` in `#064B2B`. A trial trace matched the PNG closely and is
   ~4.2 KB.
2. Keep the white tile: `viewBox="0 0 1024 1024"`, `<rect width="1024" height="1024" rx="192">`
   (same 18.75% radius as before). Keep the `<title>`.
3. Not embedding the PNG inside the SVG (bigger, not a real vector).
4. Rasters are not regenerated — they already use the supplied art.
5. **Going live**: commit only `icon.svg` and this prompt on the current branch, then fast-forward
   `main` (`git push origin <sha>:main`, after checking `origin/main` is an ancestor), since Vercel
   builds `main` only. The uncommitted S22 work stays out.

## Files likely to change

- `src/app/icon.svg`

## Implementation requirements

- Write the traced SVG to `src/app/icon.svg`, formatted with the title and tile as above.
- No changes to `manifest.ts`, `layout.tsx` or other icon files.

## Security requirements

None beyond normal: no project dependency added; tracer lives in the scratchpad only.

## Acceptance criteria

- `/icon.svg` shows the chimney, four-pane window and swoosh check on a white rounded tile.
- Rendered at 32px and 256px it matches `android-chrome-512x512.png` visually.
- Live site serves the new SVG after deploy.

## Checks to run

- `npm run typecheck`, `npm run lint`.
- Render the SVG at 16/32/256 px next to the PNG and compare.
- After push: fetch `https://verifiedpropertieske.vercel.app/icon.svg` and compare to the committed file.

## Manual test steps

1. Open `https://verifiedpropertieske.vercel.app/icon.svg` — detailed logo on white.
2. Open the site in a private window on desktop Chrome/Edge (favicons cache hard): the tab icon is
   the detailed logo on a white tile, also with a dark browser theme.
