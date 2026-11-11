# Favicon and app icons

## Goal

Install the supplied Verified Properties KE favicon package (house + check mark, dark green) so the
site shows the new icon in browser tabs, bookmarks, iOS home screen and Android/PWA installs,
replacing the default `src/app/favicon.ico`.

## References read

- `AGENTS.md` (workflow, Next.js 16 notes, design tokens)
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/app-icons.md`
  — `favicon.ico` only at the top of `app/`; `icon.(ico|png|svg)` and `apple-icon.(png|jpg)`
  anywhere in `app/`; Next generates the `<link>` tags (SVG gets `sizes="any"`).
- `.../01-metadata/manifest.md` — `app/manifest.ts` returning a typed `MetadataRoute.Manifest`.
- Package `../verified-properties-ke-favicon-package/` (README, `site.webmanifest`, files below).

## Existing code inspected

- `src/app/favicon.ico` — the default Next.js icon, to be replaced.
- `src/app/layout.tsx` — `metadata` has no `icons`/`manifest`; `viewport.themeColor` is `#087443`.
- `src/lib/brand.ts` — `BRAND.name = "VerifiedPropertiesKE"`, `BRAND.description`.
- `tailwind.config.ts` — Deep green `emerald-700 #087443`, Warm canvas `canvas #F7F8F5`.
- `src/proxy.ts` — matcher is `/account/:path*`, `/admin/:path*` only, so icon and manifest
  requests are not intercepted.
- `next.config.ts` — no CSP headers, so nothing blocks the manifest or icons.
- `public/` — only `images/` today.

Package contents (verified with `file`): `favicon.ico` (6 embedded PNG sizes from 16×16), `favicon.svg`,
`favicon-16x16.png`, `favicon-32x32.png`, `favicon-48x48.png`, `apple-touch-icon.png` (180×180),
`android-chrome-192x192.png`, `android-chrome-512x512.png`, `site.webmanifest`.

## Decisions and assumptions

1. **Use Next.js file conventions, not hand-written `<link>` tags.** The package README targets a
   plain `index.html`; this app lets Next generate the head tags from files in `src/app/`.
2. File mapping:

   | Package file                  | Goes to                                  | Served as                      |
   | ----------------------------- | ---------------------------------------- | ------------------------------ |
   | `favicon.ico`                 | `src/app/favicon.ico` (replace)          | `/favicon.ico`, `sizes="any"`  |
   | `favicon.svg`                 | `src/app/icon.svg`                       | `/icon.svg`, `type=image/svg+xml` |
   | `apple-touch-icon.png`        | `src/app/apple-icon.png`                 | `/apple-icon.png`, 180×180     |
   | `android-chrome-192x192.png`  | `public/android-chrome-192x192.png`      | manifest icon                  |
   | `android-chrome-512x512.png`  | `public/android-chrome-512x512.png`      | manifest icon                  |
   | `site.webmanifest`            | replaced by `src/app/manifest.ts`        | `/manifest.webmanifest`        |

3. **Skip `favicon-16x16.png`, `-32x32.png`, `-48x48.png`.** The `.ico` already holds those sizes
   and modern browsers take the SVG; adding them only adds more `<link>` tags.
4. **Manifest colours follow the design tokens, not the package values.** `theme_color` = Deep
   green `#087443` (same as `viewport.themeColor`), `background_color` = canvas `#F7F8F5`. The
   package's `#064B2B` / `#F8F7EF` are not tokens. The icon artwork itself keeps its own
   `#064B2B` green — it's the supplied logo art, not UI colour.
5. Manifest `name` = `BRAND.name` (one source for the product name); `short_name` = "Verified KE"
   from the package; `description` = `BRAND.description`; `start_url` `/`; `display`
   `standalone`. Icons: 192 and 512 with `purpose: "any"`. No `maskable` icon (the artwork was not
   designed with the maskable safe zone).
6. `favicon.svg` is copied unchanged (its `<title>` stays). It is dark green on transparent, so
   it is low-contrast on a dark browser tab bar; a dark-mode variant is out of scope unless asked.
7. No changes to `layout.tsx` are needed — Next adds the icon and manifest links automatically.

## Files likely to change

- `src/app/favicon.ico` (replaced)
- `src/app/icon.svg` (new)
- `src/app/apple-icon.png` (new)
- `src/app/manifest.ts` (new)
- `public/android-chrome-192x192.png`, `public/android-chrome-512x512.png` (new)

## Implementation requirements

- Copy the binary files byte-for-byte from `../verified-properties-ke-favicon-package/`.
- `src/app/manifest.ts`:

  ```ts
  import type { MetadataRoute } from "next";
  import { BRAND } from "@/lib/brand";

  export default function manifest(): MetadataRoute.Manifest {
    return {
      name: BRAND.name,
      short_name: "Verified KE",
      description: BRAND.description,
      start_url: "/",
      display: "standalone",
      theme_color: "#087443",
      background_color: "#F7F8F5",
      icons: [
        { src: "/android-chrome-192x192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/android-chrome-512x512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ],
    };
  }
  ```

  No request-time data, so it is prerendered and needs no `<Suspense>` under Cache Components.
- Do not add a `metadata.icons` block or `<link>` tags by hand (would duplicate Next's output).

## Security requirements

- Static public assets only; no secrets, no new env vars, no route reads session or DB.
- The SVG is the supplied file with no scripts or external references (checked: paths, a
  `<title>`, no `<script>`/`href`).

## Acceptance criteria

- Page `<head>` contains, generated by Next:
  `<link rel="icon" href="/favicon.ico" sizes="any">`,
  `<link rel="icon" href="/icon.svg?…" type="image/svg+xml" sizes="any">`,
  `<link rel="apple-touch-icon" href="/apple-icon.png?…" sizes="180x180" type="image/png">`,
  `<link rel="manifest" href="/manifest.webmanifest">`.
- `/favicon.ico`, `/icon.svg`, `/apple-icon.png`, `/android-chrome-192x192.png`,
  `/android-chrome-512x512.png` and `/manifest.webmanifest` all return 200.
- Manifest JSON has the name, colours and two icons above.
- Browser tab shows the green house-and-check icon, not the Next.js default.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run build` (new metadata route `manifest.ts`)

## Manual test steps

1. `npm run dev`, open `http://localhost:3000`. Hard-refresh (Ctrl+Shift+R); browsers cache
   favicons hard, so if the old icon sticks, open the site in a new InPrivate window.
2. The tab shows the house-and-check icon.
3. DevTools → Elements → `<head>`: the four `<link>` tags above are present.
4. Open each URL directly: `/favicon.ico`, `/icon.svg`, `/apple-icon.png`,
   `/android-chrome-192x192.png`, `/android-chrome-512x512.png`, `/manifest.webmanifest`.
5. DevTools → Application → Manifest: name "VerifiedPropertiesKE", short name "Verified KE",
   theme colour `#087443`, both icons load with no warnings about missing icons.
6. On a phone (after deploy): Android Chrome "Add to Home screen" and iOS Safari "Add to Home
   Screen" show the green icon.
