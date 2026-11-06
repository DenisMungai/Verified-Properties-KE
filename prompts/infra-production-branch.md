# Infra — move the live site from the Neon `dev` branch to `production`

## Goal

Make https://verifiedpropertieske.vercel.app run on the Neon `production` branch, for both its
database and its photo storage. Right now it shares the `dev` branch with local development, so
the S11 sample data, throwaway test users and every local experiment are part of the live site.

After the move:

- **Live site:** uses `production`, holding only the owner's real account, its listing, photos
  and billing.
- **Local dev:** `npm run dev` stays on `dev`, unchanged.

This is step 1 of "Before real users" in `docs/PHASE1_REPORT.md`. The Phase 2 slice gets its own
prompt after this one.

## References read

- `AGENTS.md`
- `docs/PHASE1_REPORT.md`: findings F1–F4, known gaps, next steps
- `prompts/infra-frankfurt.md`, `prompts/neon-storage-and-compact-hero.md`
- Memory notes: Vercel deploy state, Neon region, local environment
- `.env.example` (storage section), `drizzle.config.ts`, `src/db/schema.ts`,
  `src/lib/storage/keys.ts`, `src/lib/storage/index.ts`, `.data/exit-run/cors.mjs`

## Current state (read 6 Nov 2026, read-only)

**Neon project `falling-sky-58396938` (Frankfurt)**

| Branch | Migrations | Data | Storage |
|---|---|---|---|
| `production` `br-mute-star-b92vpkso` (default, parent of dev/test) | 0000–0004; **0005 missing** | 4 plans only (starter 1, pro 2, agency 3, verification 1 KES, v1), 0 users | enabled, **no buckets**, only Neon's default credential |
| `dev` `br-ancient-pine-b91b3kvl` | 0000–0005 | owner account + 20 throwaway/SAMPLE users, 44 properties, 66 images, 13 invoices, 65 payment events | `listing-photos` (public_read), `private-uploads` (private), credential `verifiedpropertieske-app` |

**The owner's data on `dev`**

- 1 user, 1 credential account (password hash) and 3 roles: `buyer_tenant`, `agent`,
  `platform_admin`.
- 1 lister profile (no avatar, no agency).
- 1 published property, `3-bedroom-apartment-2398c4`, with 13 images (13 × 3 WebP variants = 39
  objects). `reviewed_by` is null or the owner. One moderation log row is about this property.
- 1 favourite (the owner's own listing).
- Billing: 1 subscription (active, `starter` v1, until 29 Nov), invoice `VPK0000005`, 1 payment
  and 6 payment events.
- No reminders, billing audit rows, reports, inquiries or verification requests.
- 2 more moderation log rows: the owner, as admin, acting on sample or walkthrough listings.
  Those listings aren't copied, so these rows aren't either.

**Vercel production env (`prj_ymznDIZrYV3fJBhtLmlxVYri6SUU`)**

- `DATABASE_URL` is the `dev` pooled string.
- Storage points at the dev branch:
  - `STORAGE_S3_ENDPOINT`, `STORAGE_PUBLIC_BASE_URL` = `https://br-ancient-pine-b91b3kvl.storage…`
  - `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY` = the dev credential
- **Bug:** `NEXT_PUBLIC_APP_URL` is `https://verified-properties-ke.vercel.app`, the hyphenated
  host that returns 404. The live host is `https://verifiedpropertieske.vercel.app`.
- These don't change: Better Auth, Upstash, M-Pesa sandbox and QStash vars, and
  `MPESA_CALLBACK_ALLOWED_IPS`.

## Decisions

1. **Copy scope: your choice, "My account + billing".** Copy the owner's user, account, roles,
   lister profile, property, images, its moderation row, the favourite, and the subscription,
   invoice, payment and payment events. Keep every id the same so photo keys and links still
   work.
   - Map the plan ids: the subscription and invoice point at dev's plan ids, which don't exist on
     production. Remap them by `(code, version)` to production's plans. The terms are identical
     (same codes, versions and prices).
   - Nothing else is copied: no sessions (you sign in again), no samples, no throwaway users.
2. **Copy method: a one-off script in the scratch folder, not committed.**
   - Location: `.data/move-prod/copy.ts` (`.data/` is gitignored).
   - It reads the owner's rows from `dev` and inserts them into `production` in **one
     transaction**. If any part fails, nothing is written.
   - It finds the owner by user id, and never prints emails, phones, payloads or hashes, only
     row counts.
   - It refuses to run if production already holds a user. A second run therefore changes
     nothing; the way back is the rollback below.
   - Afterwards it sets production's `invoice_number_seq` to dev's last value (13). New live
     invoices then start at `VPK0000014` and never reuse an account reference the Daraja sandbox
     has already seen.
3. **Migration:** apply `0005_admin_billing` to `production` with `npm run db:migrate`, with
   `DATABASE_URL_UNPOOLED` set to production's direct string for that command only. The process
   env beats dotenv, so `.env` isn't touched.
4. **Storage on `production`:**
   - Create `listing-photos` (public_read) and `private-uploads` (private).
   - Apply the same CORS rule as dev: the live origin, `localhost:3000` and `127.0.0.1:3000`;
     PUT, GET and HEAD; the `content-type` header; 3600s max age.
   - Create a credential `verifiedpropertieske-prod` with storage read and write.
   - Copy the 39 photo variants dev → production with the S3 API: GET with the dev credential,
     PUT with the prod credential, same keys and content type. Temporary uploads in
     `private-uploads` aren't copied.
5. **Vercel production env: update 6 vars.**
   - `DATABASE_URL`: production **pooled** string, sensitive.
   - `STORAGE_S3_ENDPOINT`: `https://br-mute-star-b92vpkso.storage.c-7.eu-central-1.aws.neon.tech`.
   - `STORAGE_PUBLIC_BASE_URL`: `<that endpoint>/listing-photos`.
   - `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY`: the new prod credential, sensitive.
   - `NEXT_PUBLIC_APP_URL`: `https://verifiedpropertieske.vercel.app` (fixes the 404 host).
   - Update each var's comment to say "production branch".
6. **Deploy:** push a commit to `main` so Vercel builds with the new env. Re-deploying an existing
   deployment keeps its old env, and `NEXT_PUBLIC_*` is baked in at build time.
   - The commit holds this prompt plus the doc updates below.
   - **Approving this prompt approves that push.**
7. **Local env:** `.env` and `.env.local` stay on `dev`. Production connection strings are kept
   only in a temporary scratch file, `.data/move-prod/prod.env`. It is deleted when the move is
   done.
8. **`dev` stays as it is**, samples included. Nothing on `dev` is deleted, and no branch is reset
   or deleted.
9. **Before real-money go-live:** the copied billing rows are sandbox payments. `payment_events`
   is append-only (a trigger blocks deletes), so clearing them later is a deliberate operator
   step at the Daraja go-live: reset the production branch, or have the operator drop and
   restore the trigger. It isn't done now. The report records it.

## Cutover order

The live site keeps running on `dev` until step 7, so the outage is one build (about 1–2
minutes).

1. Write `.data/move-prod/prod.env` from the Neon connection-string tool (direct and pooled).
2. Migrate production to 0005. Check it with `drizzle-kit migrate`, which should report nothing
   left to apply.
3. Create the buckets, CORS rule and credential. Read the CORS back.
4. Copy the photos. Verify that all 39 keys exist on production with matching sizes.
5. Run the row copy. Compare counts per table, dev's owner subset against production.
6. Check the derived state on production with the app's own queries:
   - The listing is published and visible in the public listing query.
   - The owner has an active listing plan.
   - The verified view says **not verified**, since there's no review or verification
     subscription.
7. Update the 6 Vercel vars, then commit and push.
8. Check the live site once the deploy is Ready (acceptance criteria below).
9. Delete `prod.env`. Update the docs and memory notes.

## Files likely to change

```text
prompts/infra-production-branch.md   this prompt (committed)
docs/PHASE1_REPORT.md                 "Before real users": move done; F2 live upload status;
                                      the go-live note about sandbox billing rows
README.md                             deploy section: live = production branch, local = dev
                                      (only if the README describes the live branch)
.data/move-prod/*                     scratch scripts and prod.env (gitignored, deleted or kept
                                      local only)
```

No application code changes.

## Security requirements

- Connection strings, the storage credential secret, password hashes, phones, emails and payment
  payloads never appear in chat, logs, commits or docs. Scripts print counts, keys and statuses
  only.
- The prod credential secret goes straight from the Neon tool's result into the Vercel env
  (sensitive) and the scratch file. It's deleted from the scratch file at the end.
- `git status` before the commit shows no `.env*` or `.data/` file.
- No destructive Neon action: no branch reset or delete, no bucket delete, no object delete on
  `dev`.
- The copy script refuses to run if production already has users. It runs in one transaction.
- Entitlement still comes only from the copied, confirmed payment. No subscription is created or
  extended by hand.

## Acceptance criteria

1. Production `drizzle.__drizzle_migrations` has 6 rows, and `drizzle-kit migrate` has nothing
   to apply.
2. Production holds exactly the owner's subset: 1 user, 1 account, 3 roles, 1 profile,
   1 property, 13 images, 1 moderation row, 1 favourite, 1 subscription, 1 invoice, 1 payment
   and 6 events.
   - The subscription and invoice point at production's `starter` v1 plan.
   - `invoice_number_seq` = 13.
3. Production `listing-photos` has the 39 variant objects. Both buckets return the CORS rule.
4. Vercel production env shows the 6 updated vars, and the deploy of the new commit is **Ready**.
5. On https://verifiedpropertieske.vercel.app, checked in Edge at 1280px and 390px:
   - Home and `/properties?type=rent` show only the owner's listing, with photos loading from
     the `br-mute-star…` storage host. No SAMPLE listings appear.
   - The listing detail page renders with all 13 photos.
   - The owner signs in with their existing password and sees the active Starter plan in billing.
   - Admin pages open for the owner. A throwaway dev user's email can't sign in.
   - Links in emails and the auth base URL use the non-hyphenated host (`NEXT_PUBLIC_APP_URL`
     fixed).
6. A storage preflight from the live origin to the production endpoint gets 200 with a matching
   allow-origin.
7. Local `npm run dev` still shows dev data (samples included). Nothing on `dev` changed.
8. `npm run typecheck`, `npm run lint` and `npm test` pass. No app code changed, so `build` runs
   on Vercel.

## Checks to run

```bash
npm run typecheck && npm run lint && npm test
DATABASE_URL_UNPOOLED=<prod direct, from scratch file> npx drizzle-kit migrate   # nothing to apply
```

- Row-count comparison and photo-key check (the scratch scripts).
- Vercel deployment status, plus `get_runtime_errors` for the first minutes after cutover.
- Live checks in Edge via `playwright-core`, signed-out pages only. The signed-in steps are
  yours, below, because the live sign-in uses your password.

## Manual test steps (after implementation)

1. Open https://verifiedpropertieske.vercel.app in a private window. You should see only your
   3-bedroom apartment: no SAMPLE listings and no test listings.
2. Sign in with your usual email and password. Your old session is gone, so this is expected.
3. **Account → Billing** should show Starter, active until 29 Nov 2026.
4. **Close F2:** open your listing's edit page, add one photo and save. Then check that it shows
   on the public detail page. This is the real live upload still owed from S11.
5. Open the admin area and check the moderation and billing screens load. They should be empty
   apart from your own records.
6. On your computer, `npm run dev` → http://localhost:3000 still shows the sample listings.
   Local work never touches the live data again.
7. **Rollback, if anything is wrong:** tell me. I set the 6 Vercel vars back to the `dev` values
   (from your local `.env` / `.env.local`; the app URL stays fixed) and push an empty commit to
   redeploy. Production's copied data stays where it is and can be redone.
