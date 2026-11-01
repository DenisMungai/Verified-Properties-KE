# Lister avatars (profile pictures) on the profile, cards and detail page

## Goal

1. Let a lister upload, replace and remove a profile picture (avatar) on **Account → Listing
   profile**.
2. Show the lister's avatar on every property card, in the lister row at the bottom of the card,
   next to the lister's name.
3. Show the same avatar in the detail page's contact card next to the lister's name.
4. Listers without an avatar get their initials in a mint circle, so every card looks the same.

## References read

- `AGENTS.md` (storage layers, security, design rules, compact type sizes)
- `docs/implementation-plan-v2.md` §"Authentication and accounts": "Lister profile (display name,
  phone, public email, **avatar**, agency)"
- `prompts/s4-images.md` pipeline as implemented (presigned upload → verify → WebP variants)
- `prompts/ui-design-cards-detail.md` (current card and contact card layout)

## Existing code inspected

- `src/db/schema.ts`: `lister_profiles.avatar_key text` **already exists** (unused); `agencies.logo_key` exists
- `src/db/queries/lister-profiles.ts`, `src/app/account/actions.ts` (`saveListerProfileAction`),
  `src/app/account/profile/page.tsx`, `src/components/account/ListerProfileForm.tsx`
- `src/lib/storage/{keys,limits,ingest,image-processing,cleanup,index,dev-disk}.ts`,
  `src/lib/jobs/storage-cleanup.ts`
- `src/app/account/listings/photo-actions.ts`, `src/components/listings/PhotoManager.tsx` (upload client)
- `src/app/api/dev-storage/{upload,public/[...key]}/route.ts`
- `src/db/queries/public-listings.ts` (`PublicListingCard`, `CARD_COLUMNS`, `matchedSql`),
  `src/db/queries/listing-detail.ts`, `src/components/search/card-data.ts` (`toCardData`)
- `src/components/search/PropertyCard.tsx`, `src/components/listing/ListerPanel.tsx`
- `src/lib/rate-limit.ts` (`POLICIES`)

## Decisions and assumptions

1. **"Avatar" and "profile picture" are the same thing**: one uploaded photo per lister, stored in
   the existing `lister_profiles.avatar_key`. No schema change and no migration.
2. **Same upload pipeline as listing photos**: the browser PUTs to a presigned URL in the
   **private** bucket, then a Server Action verifies the real file type, decodes, strips metadata
   and writes WebP to the **public** bucket. File bytes never pass through a Server Action.
3. **Square variants**: centre-cropped `128` and `384` px WebP squares
   (`avatars/<userId>/<uuid>-128.webp`, `-384.webp`). Input: JPEG, PNG or WebP, ≤ 8 MB,
   at least **200 × 200** px (not the 800 × 600 listing-photo minimum).
4. **Agency listings show the agency's logo**, because the card shows the agency's name for them:
   avatar key = `agencies.logo_key` when the listing has an agency, else the lister's
   `avatar_key`. There is no agency logo upload yet, so agency listings show initials for now.
   Uploading agency logos is out of scope.
5. **Replace and remove**: a new upload swaps the key in one update, then deletes the old variants.
   "Remove photo" clears the key, then deletes the variants. A failed delete is left for the
   cleanup job.
6. **Cleanup job extended**: the existing orphan sweep also removes `avatars/` variants older than
   24 h that no `lister_profiles.avatar_key` references. Temporary avatar uploads already fall
   under the `uploads/` sweep.
7. **Upload location**: only on Account → Listing profile, above the form, as its own small panel
   (onboarding stays text-only; the profile must exist before an avatar can be set).
8. **No trust meaning**: an avatar is decoration and never implies verification. Avatars are not
   moderated in this slice (admin removal of offensive avatars is a later item; noted only).
9. **Rate limit**: new `avatarUploadPerUser` policy, 10 per hour.

## Files likely to change

- `src/lib/storage/limits.ts`: avatar limits and variant sizes
- `src/lib/storage/keys.ts`: `AVATARS_PREFIX`, avatar upload key, avatar base key, `baseKeyOfAvatarVariant`
- `src/lib/storage/image-processing.ts`: `processAvatar` (shares type detection and decode)
- `src/lib/storage/ingest.ts`: `ingestAvatarUpload`, `deleteAvatarObjects`
- `src/lib/storage/cleanup.ts`, `src/lib/jobs/storage-cleanup.ts`: sweep `avatars/`
- `src/app/api/dev-storage/public/[...key]/route.ts`: also serve `avatars/` in dev
- `src/lib/rate-limit.ts`: `avatarUploadPerUser`
- `src/db/queries/lister-profiles.ts`: `setAvatar`, `clearAvatar`, `referencedAvatarKeys`
- `src/app/account/profile/avatar-actions.ts` (new): request / finalize / remove
- `src/components/account/AvatarUploader.tsx` (new, client)
- `src/app/account/profile/page.tsx`: render the uploader
- `src/components/ui/Avatar.tsx` (new) + `src/components/ui/index.ts`: image or initials
- `src/db/queries/public-listings.ts`: `listerAvatarKey` card column
- `src/db/queries/listing-detail.ts`: `listerAvatarKey` detail column
- `src/components/search/card-data.ts`: resolve `listerAvatarKey` → `listerAvatarUrl`
- `src/components/search/PropertyCard.tsx`, `src/components/listing/ListerPanel.tsx`, `src/app/properties/[slug]/page.tsx`
- Tests: `keys.test.ts`, `image-processing.test.ts`, `cleanup.test.ts`, `ingest.test.ts`,
  `public-listings.integration.test.ts` (CARD_KEYS), new `lister-profiles` avatar integration test

## Implementation requirements

### 1. Storage

- `limits.ts`: `AVATAR_SIZES = [128, 384] as const`, `MIN_AVATAR_SIDE = 200`,
  `avatarVariantFor(width)` (128 for ≤ 128, else 384). Reuse `MAX_UPLOAD_BYTES` and `IMAGE_MIME_TYPES`.
- `keys.ts`:
  - `AVATARS_PREFIX = "avatars/"`.
  - `newAvatarUploadKey(userId)` → `uploads/<userId>/avatar/<uuid>`; `isOwnAvatarUploadKey(key, userId)`.
    The `avatar` segment can never collide with a listing upload (those need a UUID there).
  - `newAvatarBaseKey(userId)` → `avatars/<userId>/<uuid>` (validates `SAFE_SEGMENT`).
  - `avatarVariantKeys(base)`, `baseKeyOfAvatarVariant(key)` (strict regex, null otherwise).
- `image-processing.ts`: `processAvatar(input)`: same magic-byte check, `failOn: "error"`,
  `limitInputPixels`, `.rotate()`. Reject below 200 × 200 with
  "Profile photos must be at least 200 × 200 pixels." For each size:
  `resize({ width, height: width, fit: "cover", position: "centre" }).webp({ quality: 80 })`.
- `ingest.ts`: `ingestAvatarUpload({ privateStore, publicStore, userId, uploadKey })`, mirroring
  `ingestUpload` (own-key check, capped read, write variants, roll back on a failed put, always
  delete the temporary upload). `deleteAvatarObjects(store, baseKey)`.
- `cleanup.ts`: add `referencedAvatarKeys` to the args and an `avatars/` pass, same 24 h rule.
  Result gains `avatarsDeleted`. The job passes the new query.
- Dev public route: allow `AVATARS_PREFIX` as well as `LISTINGS_PREFIX`.

### 2. Database queries (`lister-profiles.ts`)

- `setAvatar(tx, userId, baseKey)` → returns the previous key (or null); `null` when the user has
  no profile (the caller then deletes the new objects and refuses).
- `clearAvatar(tx, userId)` → returns the removed key or null.
- `referencedAvatarKeys(db, keys)` → `Set` (chunks of 500, like `referencedBaseKeys`).
- `saveListerProfile` must keep not touching `avatarKey`.

### 3. Server Actions (`src/app/account/profile/avatar-actions.ts`, `"use server"`)

- `requestAvatarUploadAction({ contentType, size })`: `requireUser`, the user must have a lister
  profile, Zod on type/size, rate limit `avatarUploadPerUser`, presign a PUT for
  `newAvatarUploadKey(user.id)` with `PRESIGN_SECONDS`.
- `finalizeAvatarUploadAction({ uploadKey })`: `requireUser`, `ingestAvatarUpload`, `setAvatar` in
  a transaction, delete the old variants after commit, `refresh()`. On a failure after ingest,
  delete the new variants.
- `removeAvatarAction()`: `requireUser`, `clearAvatar`, delete the variants, `refresh()`.
- Same typed results and messages style as `photo-actions.ts` (`StorageNotConfiguredError` →
  "Photo uploads are not set up yet."). Logs carry no keys or personal data.

### 4. Profile page UI

- `AvatarUploader` (client) in a panel above `ListerProfileForm` on `/account/profile`:
  - Left: current avatar at 80px (`Avatar size="xl"`), or initials.
  - Right: title "Profile photo" (`text-small font-semibold`), hint `text-micro text-slate-600`
    "JPEG, PNG or WebP · up to 8 MB · at least 200 × 200. Shown on your listings.", then a
    secondary "Upload photo" / "Change photo" button (hidden `<input type="file" accept>`), and a
    quiet "Remove" button when a photo is set.
  - Client pre-checks type and size (same constants) before requesting a URL; shows progress text
    "Uploading…" / "Processing…", errors through `FormAlert`, success "Profile photo updated."
  - Panel: `rounded-lg border border-line bg-white p-5`, `flex items-center gap-5`, `max-w-2xl`.
- The page loads the profile's `avatarKey`, resolves it with `publicImageBaseUrl`, and passes
  only the URL to the client component.

### 5. `Avatar` component (`src/components/ui/Avatar.tsx`)

- Props: `name`, `baseUrl: string | null`, `size: "xs" | "sm" | "md" | "xl"` → 20 / 32 / 40 / 80 px.
- With a URL: `next/image` with a loader that appends `-128.webp` or `-384.webp` via
  `avatarVariantFor`, `rounded-full object-cover`, `alt=""` (the name is always next to it).
- Without: `rounded-full bg-mint-50 text-emerald-700 font-semibold` with up to two initials
  (`aria-hidden`), font size `text-micro` for xs/sm, `text-small` for md, `text-title` for xl.
- Client-safe (no server imports). Add to `src/components/ui/index.ts`.

### 6. Card and detail data

- `PublicListingCard` gains `listerAvatarKey: string | null`; add it to `CARD_COLUMNS` and to
  `matchedSql`:
  `case when ${p.agencyId} is not null then ${agencies.logoKey} else ${listerProfiles.avatarKey} end`.
- `PropertyCardData` replaces it with `listerAvatarUrl: string | null` in `toCardData` (keys never
  reach the browser, same as `coverKey`).
- `listing-detail.ts`: same expression as `listerAvatarKey`; the page resolves it to a URL before
  passing to `ListerPanel`.

### 7. Card and contact card UI

- Card lister row: replace the 6px dot with `<Avatar size="xs" />` (20px), `gap-2`, name
  `text-micro text-slate-700`, truncate; sr-only "Listed by " kept.
- `ListerPanel`: `flex items-center gap-3` with `<Avatar size="md" />` (40px) left of the name and
  verified line.

## Security requirements

- Uploads only through presigned PUTs to the private bucket under the caller's own
  `uploads/<userId>/avatar/` prefix; finalize accepts only a key issued to that user.
- Real type from magic bytes, decode with pixel limit, re-encode to WebP (drops EXIF/GPS);
  declared type and file name ignored. User file names never become keys.
- Every action re-checks the session and the lister profile; nobody can set another user's
  avatar. Rate limited.
- Storage keys stay on the server: cards and pages receive URLs only.
- Dev public route still refuses `uploads/` and anything not ending in `.webp`.

## Acceptance criteria

- On Listing profile, uploading a 1000 × 600 JPEG shows a square, centre-cropped avatar; a
  150 × 150 image or a PDF renamed `.jpg` is rejected with a clear message.
- Changing the photo replaces it everywhere; the old variants are deleted.
- "Remove" returns to initials everywhere.
- Cards on home, search, saved and similar listings show the avatar (or initials) next to the
  lister's name; the detail contact card shows it at 40px.
- Agency listings show initials of the agency name (no logos yet).
- Keys never appear in page HTML or RSC payload; only URLs.
- The orphan sweep deletes unreferenced `avatars/` variants older than 24 h and keeps referenced ones.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm test`
- `npm run test:integration` (card columns, avatar queries)
- `npm run build`

## Manual test steps (after implementation)

1. `npm run dev`; sign in as a lister; open **Account → Listing profile**.
2. Upload a JPEG ≥ 200 × 200: progress, then "Profile photo updated." and the new avatar.
3. Try a 150 × 150 image → size error; try a non-image renamed `.jpg` → type error.
4. Open `/` and `/properties`: your listings' cards show the avatar beside your name.
5. Open one of your listings as a signed-out visitor: the contact card shows the avatar.
6. Change the photo; refresh a card; the new photo shows. Then **Remove**: initials show.
7. A lister with no photo: cards show initials in a mint circle.

## Addendum (user, on approval): home page cards in four columns

- New `HOME_CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4"` in
  `PropertyCard.tsx`, used only by the home listings section (search, saved, verified strip keep
  `CARD_GRID` 1 / 2 / 3). No 3-column step, so the home rows always fill.
- `HOME_SLOTS` back to 8 (two full rows of four); home skeleton shows 4 cards.
- Home cards pass `sizes={HOME_CARD_IMAGE_SIZES}` = `"(min-width: 1280px) 340px, (min-width: 640px) 50vw, 100vw"`.
- Update the `prompts/ui-design-cards-detail.md`-era wording in `AGENTS.md`: home grid 1 / 2 / 4.
