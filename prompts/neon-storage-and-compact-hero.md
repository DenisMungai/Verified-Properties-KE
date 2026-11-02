# Live photos on Neon Object Storage + compact (Airbnb-height) home hero

## Goal

1. Listing photos show and uploads work on the live site
   (`https://verified-properties-ke.vercel.app`) and in local dev, from one shared store, and the
   69 photos already uploaded in development appear in both.
2. The home hero is shorter, closer to Airbnb's compact banner height, so listings show sooner.

## References read

- `AGENTS.md` (stack, layers, security, compact design rules)
- `prompts/s4-images.md` (storage modes, keys, presigned browser uploads)
- `prompts/ui-hero-auth-photos.md`, `prompts/ui-clear-header-over-hero.md`
- `neon:neon-object-storage` skill; Neon docs `storage/s3-compatibility` (CORS rules, OPTIONS
  preflight, presigned GET/PUT, `Content-Type` and `Cache-Control` on PutObject all supported;
  path-style addressing and SigV4 only)
- User choice 2026-11-02: use **Neon storage instead of Cloudflare R2**

## Existing code and account state inspected

- `src/lib/storage/index.ts`: `storageModeFor()` picks `r2` only when all six `R2_*` variables are
  set, else `dev-disk` (development) or `none` (production → `publicImageBaseUrl()` is `null`,
  uploads refused). That is why the live site has no photos.
- `src/lib/storage/r2.ts`: S3 client with endpoint built from `R2_ACCOUNT_ID`, region `auto`,
  virtual-host addressing; presigned PUT signs `content-type` and `content-length`.
- `src/lib/env.ts` / `src/lib/env.test.ts`: the six optional `R2_*` variables.
- `src/components/listings/ListingImage.tsx`: `next/image` with a custom loader returning the
  stored WebP variant URL directly, so no `remotePatterns` change is needed; no CSP in
  `next.config.ts`.
- `.data/storage/public/listings/…`: 69 WebP files (2.2 MB) whose keys match the DB rows.
- Neon dev branch `br-ancient-pine-b91b3kvl` (now used by both `npm run dev` and Vercel
  production): object storage **enabled**, endpoint
  `https://br-ancient-pine-b91b3kvl.storage.c-7.eu-central-1.aws.neon.tech`, region
  `eu-central-1`, path-style required. No buckets yet.
- Docs naming R2: `AGENTS.md` (stack, layers, security), `README.md` (stack line, "Photo storage
  (R2)" section, layout), `.env.example`.
- Home hero (`src/app/page.tsx`): `min-h-[467px] sm:min-h-[587px]` including the 67px header over
  it; H1 up to `clamp(2.6rem,5.8vw,4.75rem)`; padding `py-10 sm:py-14 lg:py-16`.

## Decisions

1. **One generic S3-compatible store replaces the R2-specific one.** `r2.ts` becomes `s3.ts`
   (`createS3Store({ endpoint, region, accessKeyId, secretAccessKey, bucket })`, always
   `forcePathStyle: true`). Mode `r2` becomes `s3`. Works for Neon now and for R2 later
   (endpoint `https://<account>.r2.cloudflarestorage.com`, region `auto`) with no code change.
2. **Variables** (replace the six `R2_*`; all server-only):
   | Variable | Value for Neon |
   |---|---|
   | `STORAGE_S3_ENDPOINT` | the dev branch storage endpoint above |
   | `STORAGE_S3_REGION` | `eu-central-1` (default `auto` when unset) |
   | `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | Neon credential (decision 4) |
   | `STORAGE_PUBLIC_BUCKET` | `listing-photos` |
   | `STORAGE_PRIVATE_BUCKET` | `private-uploads` |
   | `STORAGE_PUBLIC_BASE_URL` | `<endpoint>/listing-photos` |
   Mode `s3` needs all of them except the region. Production without them stays `none`;
   development without them stays `dev-disk`.
3. **Buckets on the dev branch** (via the Neon connector): `listing-photos` = `public_read`,
   `private-uploads` = `private`. Buckets are branch-scoped: they live with the dev data the live
   site now uses. If the live site later moves to the `production` branch, the photos must be
   copied there too (noted in the README).
4. **Credential**: one Neon credential on the dev branch, scopes `storage:read` + `storage:write`,
   name `verifiedpropertieske-app`. Its key ID and secret go to Vercel (production, `sensitive`)
   and `.env.local`. If writing them to `.env.local` is blocked, you paste them yourself (I give
   the exact lines with placeholders).
5. **CORS** on both buckets (S3 `PutBucketCors`): methods `PUT`, `GET`, `HEAD`; origins
   `https://verified-properties-ke.vercel.app`, `http://localhost:3000`, `http://127.0.0.1:3000`;
   allowed header `content-type`; max age 3600. No `*`.
6. **Copy the 69 photos** from `.data/storage/public/` into `listing-photos` with the same keys,
   `Content-Type: image/webp`, `Cache-Control: public, max-age=31536000, immutable`, via a one-off
   script in the session scratchpad (not committed) reading `.env.local`. Private temp uploads are
   not copied. Local files are left in place.
7. **Hero height** (total, including the 67px header over it): phones `min-h-[360px]`, `sm`
   `min-h-[400px]`, `lg` `min-h-[440px]` (was 467 / 587). To fit: H1
   `text-[2.25rem] sm:text-[clamp(2.4rem,4.4vw,3.5rem)]`; padding `py-8 sm:py-10 lg:py-12`;
   badge→H1 `mt-4`, H1→body `mt-3`, body→button `mt-5`. Same photo, overlays, copy and clear-header
   behaviour; search card and listings unchanged.
8. **Docs**: `AGENTS.md` stack/layers/security say "Neon Object Storage (S3-compatible)" instead of
   R2; README photo-storage section rewritten for the `STORAGE_*` variables and Neon buckets;
   `.env.example` R2 block replaced.
9. **Deploy**: commit, push to `main`, and make sure production is a **fresh build from Git**
   (not "redeploy existing", which keeps the old env vars). Also confirm the earlier switch of
   `DATABASE_URL` to the dev branch is live.

## Files likely to change

- `src/lib/storage/r2.ts` → `src/lib/storage/s3.ts`
- `src/lib/storage/index.ts` (mode `s3`, new variables, public URL)
- `src/lib/env.ts`, `src/lib/env.test.ts`; new `src/lib/storage/index.test.ts` for mode selection
  and public URLs
- `src/app/page.tsx` (hero classes only)
- `AGENTS.md`, `README.md`, `.env.example`; `.env.local` (gitignored)

## Implementation requirements

- `storageModeFor(env, nodeEnv)` returns `"s3" | "dev-disk" | "none"`; same refusal behaviour as
  today in production without storage.
- `publicImageBaseUrl()` in `s3` mode: `${STORAGE_PUBLIC_BASE_URL without trailing /}/${encoded key}`.
- Presigned PUT keeps signing `content-type` and `content-length`.
- No other storage callers change (they use `getPublicStore()` / `getPrivateStore()`).
- Tests: mode selection (all set → s3; partial → dev-disk / none; region optional) and the public
  URL; existing env test updated to a `STORAGE_*` variable.

## Security requirements

- The credential is scoped to storage read/write on the dev branch only; its secret is never
  printed in chat, committed or logged; Vercel type `sensitive`; `.env.local` stays gitignored.
- `private-uploads` stays private; only `listing-photos` is public-read (it holds processed public
  photos only, as today).
- CORS limited to the production origin and local dev origins.
- Nothing is deleted in Neon or Vercel.

## Acceptance criteria

- Live `/`, `/properties` and a listing detail page show photos (no grey placeholders).
- Signed in on the live site, uploading a JPG to a listing processes and shows it.
- `npm run dev` shows the same photos from Neon storage, and local uploads work.
- Home hero ≈440px tall at 1440px (incl. header) and ≈360px at 390px; text and button fit; header
  clear over the hero and solid after scrolling.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass.

## Checks to run

`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`; live smoke test with Edge
(pages, photo URLs return 200 with `image/webp`, one upload).

## Manual test steps (after implementation)

1. Open https://verified-properties-ke.vercel.app — shorter hero, listing photos visible.
2. Sign in with your account, open a listing → Photos, upload a JPG; it appears after processing.
3. Restart `npm run dev`, open http://localhost:3000 — same photos; upload one locally too.
