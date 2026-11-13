# Owner task: fill the 45agencies agency plan to 100 listings

## Goal

Add 99 new listings to the owner's agency **45agencies** on production, so its Agency plan pool
(limit 100) is full. Each listing has original wording, realistic Kenyan details and free-licence
photos found online. They go live immediately and can all be removed with one command.

This is an owner data task, not a slice. No app code, schema or migration changes.

## References read

- `AGENTS.md` (business rules §6, data conventions §7, security §8).
- Memory: production state (`vercel-deploy-state`), parallel sessions, production write rules.
- `src/db/seed/seed.ts`, `src/db/seed/sample-data.ts` (photo pipeline, listing insert, removal).
- `src/lib/validation/listing.ts` (`parseListing`, `normalizeForCategory`, limits).
- `src/lib/kenya.ts` (`KENYA_COUNTIES`, `AMENITIES`, `COMMERCIAL_SUBTYPES`).
- `src/lib/storage/*` (`processImage`, `newImageBaseKey`, `variantSuffix`, `createS3Store`, limits).
- `src/db/queries/moderation.ts` (`approveListing` writes `reviewed_by`, `reviewed_at`, log `approve`).
- `.data/owner-test/activate-agency.ts` (production guard pattern).
- Unsplash licence: free for commercial use, no attribution required; Unsplash+ photos excluded.

## Existing state inspected (production, read-only, 2026-11-13)

- Agency `45agencies` (`fcc09741-04f4-4a9d-af50-e82361f54e8f`), one member: the owner, `admin`.
- Active Agency subscription, `listing_limit` 100, period ends 2026-12-12.
- 1 listing in the pool (`3-bedroom-apartment-2398c4`, published, 13 photos). 99 free slots.
- The owner is not a verified lister (`verified_listers_now` is empty).
- No cache tags in the app, so new rows show on the next request.

## Decisions (owner answers, 2026-11-13)

1. **Published now.** Each listing is inserted `published` with `reviewed_by` = the owner,
   `reviewed_at` = insert time and one `listing_moderation_log` row (`action: "approve"`,
   reason `Owner-requested demo listing, 2026-11-13`), matching what `approveListing` records.
2. **Labelled in the description.** Every description ends with:
   `Note: this is a demo listing published by 45agencies to showcase VerifiedPropertiesKE. It is not an available property.`
   Titles stay plain. Photo alt text describes the photo honestly (no "this property" claims of
   a real place).
3. **Mostly Nairobi metro.** About 70 in Nairobi, Kiambu, Kajiado and Machakos; the rest in
   Mombasa, Kilifi, Nakuru, Kisumu, Uasin Gishu (Eldoret), Nyeri and Laikipia (Nanyuki).
4. **Mix** (99): ~40 apartments, ~30 houses, ~14 land, ~15 commercial; about 55% rent and 45%
   sale. Prices in whole KES that fit the area (e.g. Kilimani 2-bed rent KES 85,000–130,000 a
   month; Ruiru ⅛-acre plot KES 1.8–3.5M). Rent period is `month` except a few commercial
   `year`.
5. **Words.** All titles and descriptions written fresh (no copying from other sites), 400–900
   characters, varied structure, no superlatives that claim facts we can't back up.
6. **Photos.** Picked by browsing Unsplash free-licence search results (`?license=free`). No photo
   is used on more than one listing. Homes get 3–4 photos (exterior or main room first),
   commercial 3, land 2. About 280 photos in total. Downloaded at `w=1600` JPEG, run through the
   real `processImage` (so the 800 × 600 minimum and 480/960/1600 WebP variants apply), uploaded
   with `newImageBaseKey` keys and `IMMUTABLE_CACHE`. First photo is the cover.
7. **Points.** `public_latitude/longitude` = the neighbourhood centre only; exact point null,
   `show_exact_location` false. No made-up street addresses (`address_label` null).
8. **No fake engagement.** No view counts, saves, enquiries or reviews are seeded.
9. **Publish dates** spread over the last 30 days so "Newest" looks natural; `created_at` matches.
10. **Slugs** are `makeSlug(title, suffix)` with a fixed 6-hex suffix derived from each listing's
    key, so a rerun skips listings already inserted.
11. **Agency link.** `owner_user_id` = the owner, `agency_id` = 45agencies.
12. **Where the files live.** Everything goes in gitignored `.data/agency-fill/` (production
    one-off, like `.data/owner-test/`). Nothing is committed.

## Files

- `.data/agency-fill/photos.json` — curated photos: Unsplash id, category, alt text, page URL.
- `.data/agency-fill/listings.ts` — the 99 listings (key, fields, neighbourhood point, photo ids).
- `.data/agency-fill/fill-agency.ts` — the runner.
- `.data/agency-fill/cache/` — downloaded originals (reused between dev and prod runs).
- `.data/agency-fill/manifest-<target>.json` — written by each run: property ids, slugs, image keys.

## Runner requirements (`fill-agency.ts`)

Run with `node --env-file=.env --env-file=.env.local --conditions=react-server --import tsx`.

- Args: `--target dev|prod`, `--agency <slug>`, `--dry-run`, `--remove`.
- `--target prod` refuses unless the DB host starts with `ep-summer-morning-b9otl4v9` (from
  `PROD_DATABASE_URL_UNPOOLED`) and the storage endpoint is the production branch
  (`br-mute-star-b92vpkso`). It reads production storage keys from `PROD_STORAGE_ACCESS_KEY_ID`
  and `PROD_STORAGE_SECRET_ACCESS_KEY`, bucket `listing-photos`. `--target dev` refuses the
  production host and uses the normal `.env` storage.
- Before writing: load the agency by slug, require an `admin` member, an active agency
  subscription, and compute free slots = limit − `countActiveListings` for the agency pool. Insert
  at most that many (stop cleanly when full; never exceed the limit).
- Validate every listing first with `parseListing` plus: county in `KENYA_COUNTIES`, amenities ⊂
  `AMENITIES`, subtype ⊂ `COMMERCIAL_SUBTYPES` for commercial, photo count 1–20, unique photo ids
  across all listings, description ends with the demo note. Any failure stops the run before
  any write.
- `--dry-run`: validation, photo downloads and `processImage` only; prints what would be inserted
  per category/county and the slot count. No DB or storage writes.
- Per listing: upload its photo variants, then one transaction inserts the property, its
  `property_images` rows and the moderation log row. If the transaction fails, delete that
  listing's uploaded objects. Existing slug → skip.
- Downloads: sequential with a small delay, 30 s timeout, retried once; a photo that fails twice
  or fails `processImage` aborts the run before any write (dry run catches this first).
- `--remove`: for listings in the target's manifest, delete their `property_images` rows and
  storage objects; delete the property where nothing references it, otherwise set it `archived`
  (same approach as `removeSampleData`). Moderation log rows stay (append-only history).
- Console output: counts only, no secrets, no connection strings.

## Security requirements

- Production DB/storage strings and keys are read from env and never printed.
- Host guards as above; no writes to any other branch by mistake.
- Only public fields are filled; exact coordinates stay null.
- Nothing in `.data/` is committed.

## Acceptance criteria

- Agency pool shows exactly 100 active listings (1 existing + 99 new), all `published`.
- Each new listing passes `parseListing`, has 2–4 photos with a cover, a demo note, an approve
  log row by the owner, and appears on `/explore`, its detail page and `/agencies/45agencies`.
- No photo id repeats; every photo is from Unsplash's free licence.
- Rerunning inserts nothing; `--remove` takes all 99 down.
- `npm run typecheck` and `npm run lint` still pass (no app files changed).

## Checks to run

1. `npm run typecheck`, `npm run lint`.
2. `fill-agency.ts --target dev --dry-run` (full validation and image processing).
3. If dev has an agency with an active Agency plan, a real dev run plus `--remove`; otherwise the
   dry run is the dev check.
4. `fill-agency.ts --target prod --agency 45agencies --dry-run`, then the real production run.
   Production writes are blocked for me by the auto-mode classifier, so either the owner approves
   that command when asked, or runs it (exact command given).
5. Read-only production check: counts by status, photos per listing, the 100 total.

## Before the production run, the owner needs to

Add to `.env.local` (never committed) a production storage key pair from the Neon console
(project falling-sky-58396938 → branch `production` → Object Storage → credentials; the existing
`verifiedpropertieske-prod` pair, or a new one):

```
PROD_STORAGE_ACCESS_KEY_ID=...
PROD_STORAGE_SECRET_ACCESS_KEY=...
```

## Manual test steps (after the run)

1. Open https://verifiedpropertieske.vercel.app/agencies/45agencies — 100 listings.
2. `/explore` with Recommended, Newest and Price sorts: new listings appear, max 3 per lister in
   the first 20 still holds for other listers.
3. Open 3 random new listings (one land, one commercial, one apartment): photos load in all
   sizes, the demo note shows at the end of the description, no exact map pin.
4. Lister dashboard → Listings: 100 of 100 used; publishing another is refused (limit reached).
5. To take them down later: `node --env-file=.env --env-file=.env.local --conditions=react-server --import tsx .data/agency-fill/fill-agency.ts --target prod --agency 45agencies --remove`.
