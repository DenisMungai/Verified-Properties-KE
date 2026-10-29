# S4 — Image pipeline

## Goal

Listers add, describe, order and remove photos on their listings (plan v2.0 §9 "Image pipeline"):

1. A **Photos** step between Details and Preview, giving the design's four steps:
   Basics → Details → Photos → Preview.
2. Uploads go **directly from the browser to storage** through a short-lived presigned URL. The
   server then:
   - checks the real file type from its bytes (JPEG, PNG or WebP only)
   - checks size, pixel dimensions and the per-listing photo count
   - strips metadata (EXIF and GPS) by re-encoding
   - writes resized WebP variants under keys it generates
3. A **cover image**, required **alt text** for every photo, and reordering.
4. A **branded fallback image** wherever a listing has no cover.
5. Submit requires at least one photo.
6. Storage behind an `ObjectStore` interface with two implementations:
   - **Cloudflare R2**: a public bucket for listing images, and a private bucket for temporary
     uploads (and verification documents in Phase 2).
   - A **dev-only local-disk store**, so the pipeline works before R2 exists.
7. An orphan-cleanup function, tested now and scheduled by QStash in S9.

**Not in this slice:**
- public cards, the gallery and the detail page (S7/S8)
- the QStash schedule for cleanup (S9)
- verification document uploads (Phase 2; only the private-bucket config lands now)
- the seed's sample photos (S11)

## References read

- `AGENTS.md` §1–§10.
- Plan v2.0:
  - §9: the image pipeline (presigned uploads, signature checks, limits, EXIF strip, WebP variants
    and thumbnails, cover, alt text, fallback, orphan cleanup)
  - §5: featured quality bar (at least 5 photos and a cover); ranking counts photos
  - §6: storage choices (R2 public and private buckets)
  - §15: launch checklist ("Image constraints and cleanup working")
- `~/.claude/plans/above-is-the-scope-immutable-torvalds.md`, S4, and "External accounts" (R2
  buckets and CORS before S4).
- Design:
  - **04 — Create Listing**: the four-step stepper ("3 Photos"), card and footer patterns, and the
    tip "Add bright, genuine photos".
  - **Property card - reusable**: a 4:3 image area whose empty state is a flat soft green-grey.
    This is the basis for the fallback.
  - There is no Photos screen in the design, so the step reuses the Basics card, tips panel and
    footer.
- Next 16 docs (`node_modules/next/dist/docs/01-app/03-api-reference/`):
  - `02-components/image.md`: `loader`, `unoptimized`, `remotePatterns`; `priority` is replaced by
    `preload`
  - `05-config/01-next-config-js/serverActions.md`: Server Action bodies are limited to 1 MB by
    default, so file bytes must never go through an action
  - `05-config/01-next-config-js/proxyClientMaxBodySize.md`: the proxy buffers up to 10 MB, but
    `src/proxy.ts` only matches `/account` and `/admin`
- Reference v1.1 (read-only), adapted rather than copied:
  - `src/lib/storage/object-store.ts`, `r2.ts` (signs `content-type`), `keys.ts`
  - `src/lib/storage/image-processing.ts` (`detectImageType`, sharp `rotate()` then re-encode)
  - `src/lib/storage/ingest.ts` (prefix check on the upload key; the temporary object is always
    deleted)
  - `src/db/queries/listings.ts`: `addImage`, `setCover`, `moveImage`, `deleteImage` and
    `canAddPhotos`
  - `src/components/listings/PhotoManager.tsx`: staging with a required description per file

## Existing code inspected

- **`src/db/schema.ts` `property_images`:** `storage_key`, `alt_text` (NOT NULL, with a check that
  trimmed text is non-empty), `width`, `height`, `sort_order`, `is_cover`, and a partial unique
  index allowing one cover per listing. Cascade delete from `properties`. **No migration is
  needed.**
- **`src/lib/env.ts`:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
  `R2_PUBLIC_BUCKET`, `R2_PRIVATE_BUCKET` and `R2_PUBLIC_BASE_URL` already exist and are optional.
  All are empty in `.env` today.
- **`src/db/queries/listings.ts` (S3):** `manageableBy`, `getManageableListing` (with
  `forUpdate`), `updateListing`, `submitListing` (`parseListing` on the stored row inside the
  pool lock), `deleteDraft`, and `statusAfterEdit`, which now sends a materially edited paused
  listing to draft.
- **`src/lib/listings/workflow.ts`:** `LISTER_EDITABLE_STATUSES` and `isEditableByLister`.
- **Editor UI:**
  - `ListingStepper.tsx` already marks where Photos goes.
  - `ListingEditorLayout`, `PlanUsagePanel`, `StepFormFooter` and `ListingSummary`.
  - the preview page's missing-items checklist (`parseListing` plus `stepForField`).
- **`src/lib/rate-limit.ts`:** `POLICIES`, and production refuses to run without Upstash.
- **`src/proxy.ts`:** the matcher is `/account/:path*` and `/admin/:path*`.
- **`public/`:** empty. **`.gitignore`:** no `.data/` entry yet.
- **`package.json`:** none of `sharp`, `@aws-sdk/client-s3` or `@aws-sdk/s3-request-presigner`
  is installed.

## Decisions and assumptions

Please check these when approving. Items 4, 5, 6 and 10 are product rules I've filled in.

1. **Two buckets, and temporary uploads stay private.** The browser uploads to the **private**
   bucket under `uploads/<userId>/<listingId>/<uuid>`. Only processed, metadata-free WebP variants
   are written to the **public** bucket. In v1.1, temporary uploads sat in the public bucket for a
   short time, still holding their EXIF and GPS data; this closes that gap.
2. **The dev store** (you chose this):
   - Files live under `.data/storage/{public,private}/`, and `.data/` is git-ignored.
   - It is used only when `NODE_ENV !== "production"` **and** R2 is not configured. With R2 set,
     dev uses R2 too.
   - Its "presigned URL" points to `PUT /api/dev-storage/upload?t=<token>`. The token is an
     HMAC (using `BETTER_AUTH_SECRET`) over the key, content type, byte length and expiry, so the
     client code is identical for R2 and dev.
   - `GET /api/dev-storage/public/[...key]` serves the public folder only. Private files are never
     served.
   - Both routes return 404 in production or when R2 is configured.
   - In production without R2, photo actions return "Photo uploads are not set up yet." and log
     `[storage] not configured`. There is never a silent fallback to disk.
3. **Variants and keys.** Each photo gets one generated id, stored as the base key
   `listings/<listingId>/<imageId>`, with three WebP files:
   - `-480.webp` (editor thumbnails and small cards)
   - `-960.webp` (cards on retina screens)
   - `-1600.webp` (the gallery)

   Each is resized with `fit: inside` and no enlargement. `width`/`height` store the
   1600 variant's size. User filenames never enter a key.
4. **Limits:**

   | Rule | Value |
   |---|---|
   | File types | JPEG, PNG, WebP, decided from the file's bytes |
   | Size | 8 MB or less |
   | Dimensions | at least 800 × 600 after EXIF rotation, and at most 40 megapixels |
   | Photos per listing | at most 20 |
   | Alt text | 5–200 characters |
   | Upload rate | 80 upload requests per user per hour (`photoUploadPerUser`) |
   | Presigned URL lifetime | 5 minutes |

   The minimum size is higher than v1.1's 400 × 300 so cards and galleries stay sharp.
5. **The submit rule** gains "at least one photo, with a cover". The cover is set automatically
   on the first upload and moves to the next photo if the cover is deleted.
   - The 5-photo featured bar from plan §5 is shown as a tip only ("Listings with 5 or more photos
     can be featured"), not enforced.
   - The last photo cannot be deleted while a listing is in review, published or paused.
6. **Photo changes and review.** Adding a photo is treated as a **material edit**, using the same
   `statusAfterEdit` rule as S3:
   - An **unverified** owner adding a photo to a `published` listing sends it back to
     `pending_review`.
   - An unverified owner adding a photo to a `paused` listing turns it into a `draft`.
   - Verified owners are not affected.
   - Reordering, changing the cover, editing alt text and deleting photos are not material.

   Without this rule, an unverified lister could replace approved photos with unreviewed ones.
   The Photos step warns before upload: "Adding photos sends a live listing back to review."
7. **Two Server Actions per upload, with no file bytes in either:**
   1. `requestPhotoUpload({ listingId, contentType, size })`:
      - checks the session, the manage rule, the editable status, the count and the rate limit
      - returns `{ uploadUrl, uploadKey }`
   2. The browser `PUT`s the file to `uploadUrl`, using `XMLHttpRequest` for progress.
   3. `finalizePhotoUpload({ listingId, uploadKey, altText })`:
      - re-checks everything
      - checks that the key starts with this user's and listing's upload prefix
      - downloads at most 8 MB, then processes the image
      - writes the variants, then inserts the row in a transaction that locks the listing row
        (`FOR UPDATE`) and re-counts, so parallel uploads cannot pass 20
      - always deletes the temporary object
      - if the insert fails, deletes the variants it wrote
8. **Staging UI and required alt text** (as in v1.1):
   - Picked or dropped files appear in a staging list, each with a local preview and a required
     "Describe this photo" field.
   - **Upload n photos** is enabled once every staged file has a description of 5 characters or
     more.
   - Files upload with at most 2 at a time.
   - Files that fail stay in the list with their error and a **Retry** button.
9. **Image rendering:**
   - `ListingImage` (client) wraps `next/image` with a `loader` that maps the requested width to
     the smallest variant that covers it (480, 960 or 1600). This gives a real `srcset` with no
     Vercel image-optimisation cost and no `remotePatterns` setup.
   - When there is no key, it renders the fallback `public/images/listing-fallback.svg`: a 4:3
     mint-50/line-coloured panel with a centred lucide-style house outline and no text. Its alt
     comes from the caller.
10. **Cleanup:** `sweepOrphans({ db, publicStore, privateStore, now })` in
    `src/lib/storage/cleanup.ts` deletes:
    - private `uploads/` objects older than 24 hours
    - public `listings/<id>/<imageId>-*` objects with no matching `property_images` row and older
      than 24 hours (for example after a failed delete)

    This needs `list(prefix)` on `ObjectStore`. S9 adds the QStash route that calls it. Two
    related changes:
    - `deleteDraft` and `deletePhoto` remove their objects straight away, best effort.
    - The README recommends an R2 lifecycle rule (delete `uploads/` after 1 day) as a backstop.
11. **Dependencies:** `sharp`, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`, as in
    v1.1, where they were proven against R2. Next treats sharp as an external server package
    automatically.

## Files likely to change

```text
package.json / package-lock.json             sharp, @aws-sdk/client-s3, @aws-sdk/s3-request-presigner
.gitignore                                   .data/
src/lib/storage/object-store.ts              ObjectStore (presignPut, get, put, delete, list), errors
src/lib/storage/keys.ts (+ .test.ts)         upload keys and prefix check, image base keys, variant keys, limits
src/lib/storage/r2.ts (+ .test.ts)           R2 store (S3 API), signs content-type and length
src/lib/storage/dev-disk.ts (+ .test.ts)     dev disk store and HMAC upload tokens
src/lib/storage/index.ts                     getPublicStore()/getPrivateStore(): R2, dev disk, or not configured
src/lib/storage/image-processing.ts (+ test) detectImageType, processImage → 3 WebP variants
src/lib/storage/ingest.ts (+ .test.ts)       temp upload → verified variants in the public store
src/lib/storage/cleanup.ts (+ .test.ts)      sweepOrphans
src/lib/storage/urls.ts (+ .test.ts)         publicImageUrl(baseKey, width) and variant choice
src/lib/validation/listing.ts                photoAltSchema; the submit rule needs a photo
src/lib/rate-limit.ts                        photoUploadPerUser
src/db/queries/listing-photos.ts             listPhotos, canAddPhoto, addPhoto, setCover, movePhoto,
                                             updatePhotoAlt, deletePhoto, photo keys for a listing
src/db/queries/listing-photos.integration.test.ts
src/db/queries/listings.ts                   photo count in submit and preview data; deleteDraft returns keys
src/app/account/listings/[id]/photos/page.tsx
src/app/account/listings/photo-actions.ts    request, finalize, cover, move, alt, delete
src/app/account/listings/actions.ts          deleteDraft removes stored files
src/app/api/dev-storage/upload/route.ts      dev-only PUT
src/app/api/dev-storage/public/[...key]/route.ts  dev-only GET
src/components/listings/ListingStepper.tsx   adds "3 Photos"
src/components/listings/PhotoManager.tsx     staging, upload queue, photo list (client)
src/components/listings/ListingImage.tsx     next/image with the variant loader and fallback (client)
src/components/listings/ListingSummary.tsx   cover image and thumbnail strip in Preview
src/components/listings/PlanUsagePanel.tsx   photo tip on the Photos step
src/app/account/listings/page.tsx            64px cover thumbnail in My listings rows
public/images/listing-fallback.svg
.env.example / README.md                     R2 setup, CORS, lifecycle rule, dev store
```

## Implementation requirements

### Storage (`server-only`)

- `ObjectStore`:
  - `presignPut(key, contentType, contentLength, expiresIn)`
  - `get(key, maxBytes)`: streams, and stops with `TooLargeError` once `maxBytes` is passed
  - `put(key, body, contentType, cacheControl?)`
  - `delete(keys[])`, batched up to 1,000 keys
  - `list(prefix)`, returning `{ key, lastModified }`
- R2: the endpoint is `https://<account>.r2.cloudflarestorage.com` with region `auto`. Presigning
  signs `content-type` and `content-length`. Public objects get
  `Cache-Control: public, max-age=31536000, immutable`, which is safe because keys are never
  reused.
- Dev disk:
  - Every key is checked against `^[a-z0-9/_-]+(\.webp)?$` and resolved inside the bucket
    folder, which blocks path traversal.
  - The upload route checks the HMAC token, expiry, `Content-Type` and `Content-Length`, and
    streams with the same 8 MB cap.
  - The public GET route sets `Content-Type: image/webp` and `X-Content-Type-Options: nosniff`.
- `getPublicStore()` / `getPrivateStore()` choose R2, then dev disk (non-production only), and
  otherwise throw `StorageNotConfiguredError`.

### Processing (pure, unit-tested with images generated by sharp)

- `detectImageType` checks magic bytes. The declared type and file name are never trusted.
- `processImage`:
  - `sharp(input, { failOn: "error", limitInputPixels: 40e6 }).rotate()`
  - checks the minimum size after orientation is applied
  - writes three WebP variants: quality 80 for 960 and 1600, 75 for 480
  - output carries no EXIF, XMP or ICC metadata beyond sRGB
- Rejections use plain sentences, for example:
  - "Upload a JPEG, PNG or WebP photo."
  - "Photos must be 8 MB or smaller."
  - "Photos must be at least 800 × 600 pixels."
  - "That image could not be read. Try exporting it as a JPEG."

### Queries (`server-only`, each takes a `DbExecutor`)

- Every function applies `manageableBy(userId)`. An image id is only reachable through its
  listing, so a forged image or listing id returns `not_found`.
- Writes run in `withTransaction` with the listing row locked, and require
  `isEditableByLister(status)`.
- `addPhoto`:
  - re-counts, and refuses at 20
  - `sort_order = max + 1`
  - `is_cover` when it's the first photo
  - applies decision 6 using `isListerVerified` for the owner
  - returns `{ ok, status, returnedToReview }`
- `deletePhoto`:
  - refuses the last photo when the status is pending_review, published or paused
    (`last_photo`)
  - renumbers the remaining photos
  - moves the cover to the first remaining photo
  - returns the base key
- `movePhoto(direction: "up" | "down")` swaps neighbours. `setCover` clears the old cover first,
  so the partial unique index holds.
- `submitListing` and the preview checklist get `photoCount` and `hasCover`. A missing photo
  shows as "Add at least one photo" and links to the Photos step.

### Server Actions (`src/app/account/listings/photo-actions.ts`)

- Each action takes plain typed arguments, validated with Zod: a UUID listing id, a content type
  from the allow-list, an integer size, the upload key, and alt text.
- Each action:
  - calls `requireUser()` and the lister check
  - calls one query or the ingest function
  - returns `{ ok: true, ... } | { ok: false, error }` with user-safe messages
  - logs `[photos] <action> failed <error.name>` with no keys, file names or personal data
- After a change, call `refresh()`. A photo that returns a listing to review shows "Saved. You
  added photos, so the listing is back in review." (or the draft wording from S3).

### UI (tokens only)

- **Stepper:** 1 Basics, 2 Details, **3 Photos**, 4 Preview. Details **Continue →** goes to
  Photos, and Photos **Continue →** goes to Preview. At 390px it stays one row; if four labels
  don't fit, the labels shrink to `text-caption` and stay visible.
- **The Photos card** ("Property photos", `rounded-xl` white, padding 32 or 24 on mobile):
  - **Drop zone:**
    - a dashed `line-strong` border, `rounded-xl`, `bg-canvas`, minimum height 160px
    - the text "Drag photos here or **choose files**", where the button is the visible control
      for a `sr-only` file input with `multiple` and the `accept` list
    - the hint "JPEG, PNG or WebP · up to 8 MB · at least 800 × 600 · up to 20 photos"
    - drag-over state: an emerald-600 border on mint-50
    - keyboard: the button opens the picker
  - **Staging list:** each row shows a 4:3 preview (96px wide, 128px from `sm`), the "Describe
    this photo" `Input` with a hint, a progress bar (`role="progressbar"` with aria values), the
    state text ("Waiting", "Uploading 42%", "Processing", "Failed: …") and Remove/Retry buttons.
  - **Photo list:** an ordered list of the saved photos. Each row has:
    - a thumbnail
    - a **Cover** badge on the cover photo
    - the alt text with an **Edit description** inline editor
    - icon buttons: **Move up**, **Move down**, **Set as cover**, **Delete**. Each has an
      `aria-label` naming the photo position, for example "Move photo 2 up", and a 44px hit
      area.
    - **Delete** opens a confirm step (`<details>` disclosure, as in S3; no `window.confirm`).
    - A live region announces changes: "Photo 3 moved up", "Cover updated".
  - Count line: "4 of 20 photos".
- **Tips panel** on this step: "Add bright, genuine photos", "Start with the best room as your
  cover", and "Listings with 5 or more photos can be featured".
- **Footer:** **Save draft** goes back to My listings with "Draft saved"; **Continue →** goes to
  Preview. With uploads still running, Continue is disabled with the reason given in text.
- **Preview:** the cover is a 4:3 image at the top of `ListingSummary`, followed by a strip of up
  to 5 thumbnails and "+n more". With no photos, it shows the fallback panel and the checklist
  item.
- **My listings:** a 64px 4:3 cover thumbnail (or the fallback) before the title in table rows
  and mobile cards, with `alt=""` because the title next to it names the property.
- **Cache Components:** the Photos page reads params and the session inside `<Suspense>` with a
  skeleton. `PhotoManager` receives serialisable props only.

## Security requirements

- **File content:**
  - File bytes never pass through a Server Action, and nothing executes uploaded content.
  - The declared MIME type is checked on request (and signed into the URL), and the bytes are
    checked again on finalize.
  - Re-encoding through sharp removes metadata and neutralises polyglot files.
- **Keys and authorisation:**
  - Upload keys are server-generated and scoped to `uploads/<userId>/<listingId>/`. Finalize
    rejects any other key, which blocks ingesting someone else's upload or arbitrary bucket
    objects.
  - Every action re-checks the session, the manage rule, the editable status and the count. The
    proxy is never relied on.
  - Adding photos follows the moderation rule in decision 6.
- **Buckets:**
  - Temporary uploads go only to the private bucket. Only processed variants are public.
  - Public URLs are built only from `R2_PUBLIC_BASE_URL`, or the dev route, plus generated keys.
- **Secrets and dev routes:**
  - R2 credentials are server-only. Presigned URLs live for 5 minutes and cover one key, type and
    length.
  - The dev routes 404 in production and when R2 is configured. Their HMAC token comes from a
    server secret, and keys are checked for path traversal.
- **Abuse and logging:**
  - Upload requests are rate limited. The 20-photo limit is enforced under a row lock.
  - Logs carry no keys, file names, alt text or personal data.
- **Rendering:** alt text renders as text.

## Acceptance criteria

1. Unit tests cover:
   - `detectImageType` for JPEG, PNG and WebP, plus GIF, PDF and text renamed to `.jpg`
   - `processImage`:
     - output is WebP at three widths
     - it never enlarges
     - EXIF orientation is applied and GPS EXIF removed (a sharp-generated JPEG with EXIF in,
       no `exif` in the output metadata)
     - too-small and corrupt inputs are rejected
   - keys: the upload prefix check rejects other users, other listings and `..`; variant names
     are correct
   - the variant loader picks the smallest variant at or above the requested width, capped at
     1600
   - dev disk: an expired or tampered token is refused, a wrong length is refused, traversal
     keys are refused
   - `ingestUpload` with an in-memory store: success writes 3 objects and deletes the temp
     object; a failure still deletes the temp object; a foreign key is rejected
   - `sweepOrphans` deletes only objects that are old and unreferenced
   - the submit rule reports "Add at least one photo"
2. Integration tests on the test branch, with an in-memory store, show:
   - add → cover on the first photo; the 21st photo → `limit`
   - parallel adds never pass 20
   - a stranger and a plain agency member get `not_found`; an agency admin succeeds
   - `setCover` moves the cover; `movePhoto` swaps order; `updatePhotoAlt` rejects blank text
     (backed by the DB check)
   - deleting the cover promotes the next photo; deleting the last photo on a pending listing →
     `last_photo`; on a draft it succeeds
   - an unverified owner adding a photo to a published listing → `pending_review`, and to a
     paused one → `draft`; a verified owner's listing stays published
   - submit without photos → `invalid` with the photo item; with one photo it proceeds
   - `deleteDraft` returns the photo keys
3. The browser walkthrough (Edge via playwright-core, dev disk store) at **1280px and 390px**
   finds no horizontal overflow and no console errors. It checks:
   - Details → Photos; upload is blocked until a description is entered
   - upload 2 generated JPEGs; both appear, the first marked Cover; "2 of 20 photos"
   - a PNG renamed to `.jpg` uploads fine; a text file renamed to `.jpg` shows "Upload a JPEG,
     PNG or WebP photo."
   - move photo 2 up, set it as cover, edit a description, delete one with confirm
   - Preview shows the cover image and no "Add at least one photo" item; with all photos deleted
     on a draft, the item appears
   - My listings shows the cover thumbnail
   - keyboard: the drop-zone button, the photo controls and the confirm step are all reachable
   - the dev public route serves `image/webp`; a request for a private upload key returns 404
4. Typecheck, lint, unit tests, integration tests and the build pass. `db:generate` reports no
   schema changes.

## Checks to run

```bash
npm install
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run db:generate   # expect "No schema changes"
```

Plus the browser pass at 1280px and 390px (Edge via playwright-core in the scratchpad).

## Manual test steps (after implementation)

1. `npm install`, then `npm run dev`. With R2 unset, photos are stored in `.data/storage/`.
2. Sign in as a lister, open **My listings** and continue a draft (or create one), then go
   through Basics and Details to **3 Photos**.
3. Drop or choose 3 photos (JPEG, PNG or WebP, at least 800 × 600). **Upload** stays disabled
   until each has a description such as "Living room with balcony view".
4. Click **Upload 3 photos** and watch the progress. The first becomes **Cover**, and the
   counter reads "3 of 20 photos".
5. Try a screenshot that is too small and a `.txt` file renamed to `.jpg`. Both must show a clear
   error and leave the listing unchanged.
6. Move a photo up, **Set as cover**, edit a description, then delete a photo (confirm).
7. **Continue** to Preview. The cover is at the top and the thumbnail strip is below it. Submit
   as in S3.
8. Check that `.data/storage/public/listings/<id>/` holds `-480/-960/-1600.webp` files and that
   `.data/storage/private/uploads/` is empty after uploads finish.
9. Optional: on the dev branch, publish the listing with
   `update properties set status = 'published', published_at = now() where id = '<id>';`, then
   add a photo as an unverified lister. My listings shows **In review**.
10. At 390px, repeat step 3. Nothing scrolls sideways, and the controls are full width.

**Before deploying (operator, once):**
1. Create the R2 buckets `vpk-listing-images` (public via a custom domain or r2.dev) and
   `vpk-private` (no public access).
2. Create an API token with Object Read & Write on both.
3. Set the six `R2_*` variables in Vercel and `.env.local`.
4. Add CORS on **vpk-private**: `PUT` from the app origins (`http://localhost:3000` and the
   production domain) with the `content-type` header.
5. Add a lifecycle rule on `vpk-private`: delete `uploads/` after 1 day.

Then rerun step 3 against R2.
