# S12 — Paid verification: pay, upload, review, badge

First slice of Phase 2 (plan v2.0 §10).

## Goal

A lister pays for verification by STK Push, uploads the documents their lister type needs, and
submits. A platform admin then reviews the request in a private queue and decides: approve,
request changes, reject, or later suspend.

- **On approval:** the derived badge, ranking boost, public phone and pre-review skip switch on at
  once. All of these already read `lister_verified_now`.
- **On rejection:** the verification fee becomes credit on the lister's listing plan.
- **Audit:** every step is written to the append-only `verification_audit_log`.

Exit criteria from §10 covered here:

- a lister pays in the sandbox, uploads, is approved and moves to the top of search;
- lapsing and renewing restores the badge without a new review;
- a rejected lister gets the credit;
- cross-user access to documents and requests is blocked.

Home featured sections, messaging and notifications are later slices.

### Phase 2 slice plan (proposed)

| Slice | Scope |
|---|---|
| **s12-verification** (this one) | Pay, upload, submit, admin review (approve / request changes / reject / suspend), rejection credit, audit log, lister status page |
| s13-verification-lifecycle | 12-month expiry job, re-review reminders at 30 and 7 days, document retention and secure deletion (Kenya DPA), lister dashboard stats (views, saves, inquiries; verified vs before) |
| s14-featured-help | Home featured sections (§5 quality bar, 2 per lister, daily rotation, unlabelled fallback) and the verification help page |
| s15-messaging | Conversations, inbox with unread counts, participant checks, rate limits, report and block, 10–15s polling |
| s16-notifications | Resend live, delivery records, new-message and receipt alerts, a failed-jobs view for admins |
| s17-phase2-exit | Exit walkthrough and report, like S11 |

## References read

- `AGENTS.md`
- `docs/implementation-plan-v2.md`:
  - §4 (payment flow, paid verification rules, lapse table, rejection default)
  - §5 (ranking, disclosure)
  - §6 (derived badge)
  - §10 (Phase 2)
  - §14–16
- Design: `3 - Lister & Admin Dashboards/05 — Verification Review` (admin review layout) and
  `02 — Billing & Verification` (the lister verification side card; the mock's oversized text is
  a defect and isn't copied).
- `prompts/ui-compact-design-system.md`, `prompts/ui-mobile-optimization.md` (type, spacing, phone
  rules)
- `docs/PHASE1_REPORT.md`

## Existing code inspected

- **Schema** (`src/db/schema.ts`):
  - `verification_requests`, with statuses `unverified`, `payment_pending`, `under_review`,
    `verified`, `rejected`, `expired` and `suspended`, and a check that verified rows have an
    expiry.
  - `verification_documents` (storage key, document type).
  - `verification_audit_log` (append-only trigger).
  - `lister_profiles.lister_type` (agent / owner / developer, plus `agency_id`).
  - Plans have a `verification` kind (sandbox `verification` v1).
- **Derived badge:** `0002_billing.sql` defines the `verified_listers_now` view and
  `lister_verified_now()`. Badge, ranking, the verified filter and the public phone already read
  them (`db/queries/billing.ts`, `listing-detail.ts`, `public-listings.ts`).
  `lib/listings/workflow.ts#statusAfterEdit` already skips pre-review for verified listers.
- **Billing:**
  - `lib/billing/prepare-invoice.ts`: `planFitsPool` accepts listing plans only. Its
    `lockLiveSubscription(tx, owner, plan.kind)` is kind-aware.
  - `lib/mpesa/confirm.ts`: one transaction marks the payment and invoice paid and extends the
    subscription. Only listing plans restore paused listings.
  - `lib/billing/credit.ts`: `creditDaysFromPayment`, `canReceiveCredit`, `extendPeriodByDays`
    (S10 day credits, written to `billing_audit_log`).
  - `app/account/billing/checkout/page.tsx` lists listing plans only.
  - `components/billing/VerificationCard.tsx` is a "coming soon" placeholder.
- **Storage:**
  - Presigned PUT to the private bucket, then a server finalize step: `photo-actions.ts`,
    `avatar-actions.ts`, `storage/keys.ts`, `ingest.ts`, `object-store.ts`. The store has no
    presigned GET yet.
  - `storage/cleanup.ts` sweeps stale `uploads/` objects and unreferenced public variants.
- **Admin:** `components/admin/AdminNav.tsx` (Listings queue, Reports, Billing),
  `app/admin/listings/[id]`, `DecisionForms.tsx`. Moderation requires `platform_admin`.
- **Session and limits:** `lib/session.ts` (`requireUser`, `requireRole`), `lib/rate-limit.ts`,
  `lib/email` (dev prints to the terminal; Resend isn't set live).
- **Seed:** `db/seed/seed.ts` writes `verified` requests for SAMPLE listers. It writes no audit
  log rows, so the exit report flagged that gap.

## Decisions

1. **Documents by lister type (your choice; no KRA PIN).** Every file type has a label and a
   one-line hint.

   | Lister | Required document types |
   |---|---|
   | Private owner | `national_id`: national ID or passport |
   | Agent | `national_id` + `earb_certificate`: EARB practising certificate |
   | Developer | `national_id` + `business_registration`: certificate of registration or CR12 |
   | Any lister whose profile has an `agency_id` | adds `business_registration` (the agency's) |

   - **Per type:** 1–2 files (for example the ID front and back), at most 6 files in all.
   - **Formats:** PDF, JPEG or PNG, up to 10 MB each.
   - **Checks:** the server checks the magic bytes. JPEG and PNG are re-encoded with `sharp` to
     strip EXIF and GPS data. PDFs are stored as uploaded after the magic-byte and size checks.
   - **File names:** the original name is kept only as a sanitised display label (max 120
     characters, for the admin list). It never becomes part of a storage key.
2. **New status `documents_pending`, migration `0006_verification`.** It means "paid, waiting for
   documents" and is also the state after "Request changes". Life cycle:

   ```text
   payment_pending → (payment confirmed) → documents_pending → (submit) → under_review
   under_review → verified | documents_pending (changes requested, with reason) | rejected
   verified → suspended (admin)        expired arrives in s13
   ```

   - Partial unique index: at most one open request per lister (`payment_pending`,
     `documents_pending`, `under_review`).
   - New `verification_requests.invoice_id` points at the invoice that paid for the request, and
     is used for the rejection credit.
   - New `verification_documents` columns: `file_name`, `content_type`, `size_bytes`.
   - Check constraint on `verification_audit_log.action`: `start`, `pay`, `upload`,
     `remove_document`, `submit`, `view_document`, `request_changes`, `approve`, `reject`,
     `suspend`, `credit`, `credit_skipped`.
3. **Who can apply:** a user with a lister profile whose listing plan is in good standing (active
   or in grace). The badge needs that plan anyway, and the rejection credit lands on it.
   - Agency members can apply. Verification is per person; their listing plan is the agency's.
   - A lister who already has an approved, unexpired review never gets a new request. Paying only
     renews the verification subscription, so the badge returns without re-review (§4 lapse
     table).
4. **Checkout:**
   - `/account/billing/checkout?plan=verification` offers the active verification plan.
   - `planFitsPool` is extended: verification plans fit any eligible lister. Listing-plan rules
     are unchanged.
   - Creating the invoice also creates or reuses the open request in `payment_pending`, with
     `invoice_id` set and an audit `start` row.
   - The price always comes from `plans` (unchanged rule).
5. **Payment confirmation** (`confirm.ts`, the same transaction): when the plan kind is
   `verification`:
   - if the lister has an unexpired `verified` request, do nothing more (renewal);
   - otherwise move their open `payment_pending` request to `documents_pending` and write audit
     `pay`. With no open request (e.g. a C2B payment to the invoice), create one.

   Idempotent: a repeated callback finds the request already moved.
6. **Upload and storage:**
   - Keys are server-issued: `verification/<userId>/<requestId>/<uuid>` in the **private** bucket
     only, uploaded by presigned PUT (5 minutes).
   - `finalizeDocumentAction` checks, in order:
     1. the key was issued to this user for this request;
     2. the request is `documents_pending`;
     3. the object exists;
     4. the size and magic bytes are valid;
     5. the type and file counts are within limits.

     It then re-encodes images and inserts the row, with audit `upload`. A failed check deletes
     the object.
   - While the request is `documents_pending`, the lister may remove a document (object deleted,
     audit `remove_document`).
   - The storage-cleanup job also deletes `verification/` objects older than 24h that no
     document row references.
   - No public URL ever exists for these objects.
7. **Admin document viewing:** route `GET /admin/verification/documents/[documentId]`.
   - It checks the session and `platform_admin`, writes audit `view_document` (actor, document),
     and redirects to a **60-second presigned GET**. The GET has `Content-Disposition: inline`
     and the response is `Cache-Control: no-store`.
   - `ObjectStore` gains `presignGet`, on both S3 and dev-disk.
   - Listers see only their own documents' names and types, never a download link. Documents
     can't be fetched back after upload.
8. **Admin review, `platform_admin` only:**
   - `/admin/verification` is the queue: `under_review`, oldest submitted first, with the request
     age against the 2-working-day target. Tabs for Changes requested, Verified, Rejected and
     Suspended (read-only lists).
   - `/admin/verification/[id]` follows design 05: a header card (lister display name, type,
     agency, submitted date, request number `VR-` + 6 characters of the id, status badge), the
     submitted documents list with View, a review checklist, reviewer notes and actions.
   - **Approve** needs all 4 checklist boxes. The server re-checks the 4 confirmations. Result:
     `verified`, `decided_by`/`decided_at`, `review_expires_at` = decided + 12 months, audit
     `approve`.
   - **Request changes** needs a reason (10–500 characters). Result: back to `documents_pending`,
     with the reason shown to the lister, audit `request_changes`.
   - **Reject** needs a reason. Result: `rejected`, the credit below, audit `reject`.
   - **Suspend** (on a verified request) needs a reason. Result: `suspended`, which removes the
     badge at once, audit `suspend`.
   - **No self-review:** an admin can't decide on their own request.
   - Every decision locks the request row (`FOR UPDATE`) and checks the expected status, so a
     double submit or two admins racing changes nothing the second time.
9. **Rejection credit (your choice: credit to the listing plan),** in the same transaction as the
   rejection:
   - Days = `creditDaysFromPayment(paid amount on request.invoice_id, current listing plan
     price)`.
   - If `canReceiveCredit(listing subscription)`, run `extendPeriodByDays`. Write a
     `billing_audit_log` row (`credit`, the days, the reason "verification rejected") and a
     verification audit `credit` row.
   - If the plan can't receive credit, or the days come to 0, write audit `credit_skipped` with
     the cause. The admin billing page then lists it under its existing "needs attention" checks,
     so a billing admin can refund by M-Pesa manually.
   - The verification subscription is set to `cancelled`, so no renewal reminders follow.
   - Only the payment linked to this request is credited, and only once.
10. **Lister UI:**
    - A new `/account/verification` page, plus a nav item "Verification" for listers (as in the
      design sidebar).
    - It shows one state at a time:
      - **Not started:** what is checked, the price, the listing-plan requirement, "Start
        verification".
      - **Awaiting payment:** link to the open invoice.
      - **Upload documents:** a required-types checklist, an upload per type, remove, and a
        Submit button enabled when complete.
      - **Changes requested:** the admin's reason, then the upload form.
      - **Under review:** submitted date, "usually within 2 working days".
      - **Verified:** the "Profile verified" badge with its text label, and the review's expiry
        date.
      - **Verified, but a subscription has lapsed:** the badge is hidden; renew to restore it, no
        re-review needed.
      - **Rejected:** the reason, the credit applied (or "our billing team will contact you"),
        and "Apply again".
      - **Suspended:** the reason, and contact support.
    - The billing page's `VerificationCard` shows the same status in short, with a link.
    - Badge wording stays "Profile verified". Nothing says or implies a licence or guarantee.
11. **Emails (dev prints them; live once Resend is set):** to the lister on changes requested,
    approved, rejected and suspended. They hold minimal data and a link to
    `/account/verification`. A failed email never rolls back the decision: it is sent after
    commit.
12. **Rate limits:** upload presign 30 per hour per user; submit 10 per hour; admin actions use
    the existing admin limiter.
13. **Seed:** the S11 seed's verified SAMPLE requests also get an `approve` audit row, closing
    the gap the exit report noted. Sample data only; never production.

## Files likely to change

```text
src/db/schema.ts                                 enum value, new columns, partial unique index, audit check
drizzle/0006_verification.sql (+ meta)           generated, plus hand-written partial index/check if drizzle can't
src/db/queries/verification.ts                   new: lister status, queue, detail, document lookups
src/lib/verification/                            new: required-docs.ts, workflow.ts (transitions), documents.ts
                                                 (magic bytes, limits), decisions.ts (approve/changes/reject/suspend
                                                 + credit), keys
src/lib/billing/prepare-invoice.ts               verification plans fit eligible listers; create/reuse request
src/lib/mpesa/confirm.ts                         verification kind → documents_pending (or renewal no-op)
src/lib/storage/object-store.ts, s3.ts, dev-disk.ts   presignGet
src/lib/storage/cleanup.ts                       unreferenced verification/ objects
src/app/account/verification/{page.tsx,actions.ts}
src/app/account/billing/checkout/page.tsx        ?plan=verification
src/app/admin/verification/{page.tsx,[id]/page.tsx,actions.ts}
src/app/admin/verification/documents/[documentId]/route.ts
src/components/verification/*                    status panel, document upload list, admin review panel
src/components/billing/VerificationCard.tsx      real status
src/components/admin/AdminNav.tsx, src/components/layout/nav.ts
src/lib/email/*                                  4 lister emails
src/db/seed/seed.ts                              approve audit rows for SAMPLE verified listers
tests: unit + *.integration.test.ts next to the modules above
```

## Implementation requirements

- Server Actions stay thin: Zod v4 input, then `requireUser` / `requireRole(["platform_admin"])`,
  then rate limit, then a `lib/verification` function, then a typed result.
  `lib/verification/*` is `server-only` except the pure required-docs and transition helpers,
  which are client-safe and unit tested.
- One transaction per state change, including its audit row (and credit). Use the WebSocket
  client from `src/db/tx.ts`.
- Every status transition goes through one `canTransition(from, to)` helper. Unit test every edge.
- Session reads happen inside `<Suspense>` (Cache Components). No route `runtime` exports.
- Pages show only the data they need. The admin detail never shows payment payloads, and shows
  the phone as stored on the profile, not the M-Pesa number.
- Upload UI reuses `put-file.ts` (progress, retry) and the photo uploader's patterns.

## UI requirements (compact system, design 05 and 02)

- **Layout:**
  - Lister pages: the account shell, `PageContainer width="text"`.
  - Admin queue: a table at `md+`, cards below.
  - Admin detail at `lg`: two columns, documents (2/3) and checklist plus notes (1/3), with the
    actions right-aligned under them. Below `lg`: one column, actions in a `data-mobile-bar`
    bottom bar.
- **Type:** `display-sm` page H1, `title` card headings, `small` rows, labels and buttons, `micro`
  meta (file name, dates, hints, badges). No `text-base`, `text-lg` or `text-xl`.
- **Surfaces:** cards `rounded-sm` with `border-line` and `p-3`; panels `rounded-lg` with
  `p-5`/`p-6`. Document rows sit on `bg-canvas` with a PDF/IMG tile in `mint-50` with
  `emerald-700` text. The lister status card uses `mint-50` like the billing card. No shadows.
- **Status badges** use the existing Badge tones: Under review = warning, Verified = emerald,
  Changes requested = warning, Rejected / Suspended = danger, Awaiting payment = neutral. Each has
  a text label.
- **Buttons:** Approve is primary (`emerald-600`). Request changes is a secondary danger-outline
  button. Reject and Suspend are quiet danger buttons behind a confirm step. All are `h-control`
  44px.
- **Forms:**
  - Checklist: real checkboxes with 44px rows.
  - Reason: a textarea, 16px on phones.
  - Errors: inline, plus the existing `FormAlert`.
- **Phones (< 640px):** checked at 390px with no horizontal overflow. The upload buttons are full
  width.
- **Accessibility:** focus states, `aria-live` upload progress, and labels on every file input
  and checkbox. A colour never stands alone.

## Security requirements

- **Documents** go only to the private bucket. Keys are server-issued and checked as belonging to
  the user and request at finalize. There is no public URL, and admins view through a 60s
  presigned GET after a role check and an audit row. Listers can't download documents, theirs or
  anyone's.
- **Access:**
  - Every lister query is scoped by `session.user.id`. Request and document ids from the browser
    are only lookups that must belong to that user.
  - Admin pages and actions require `platform_admin`; `billing_admin` alone gets nothing here.
    Self-review is refused.
- **Entitlement:** payment never sets `verified`. Only the approve action does, and the badge
  stays derived.
- **Audit:** `verification_audit_log` stays append-only, and every listed action writes exactly
  one row.
- **Logs:** no document contents, file names, ID numbers, phones or emails. Ids and counts only.
- **Rate limits** as in decision 12. Failed checks return typed errors without internals.

## Acceptance criteria

1. Migration 0006 applies on dev, test and **production** (production via the direct string, as
   in the infra move). `drizzle-kit generate` then reports no changes.
2. Unit tests cover:
   - required documents per lister type, plus agency membership;
   - every `canTransition` edge;
   - magic-byte and size checks;
   - the credit calculation;
   - the request number format.
3. Integration tests (PGlite or the test branch) show:
   - checkout for the verification plan creates an invoice and a `payment_pending` request, with
     the price from `plans`;
   - a confirmed payment moves the request to `documents_pending`, and a repeated callback
     changes nothing;
   - submit is refused until the required types are uploaded, then the request is
     `under_review`;
   - approve makes `lister_verified_now` true (with both subscriptions active), the lister ranks
     first in Recommended, and the phone is public;
   - letting the verification subscription pass its grace makes it false; a renewal payment makes
     it true again with **no new request**;
   - request changes moves it back to `documents_pending` with the reason;
   - reject credits the listing plan (`billing_audit_log` row, period extended), cancels the
     verification subscription, and writes audit `reject` and `credit`; a second reject attempt
     changes nothing;
   - suspend removes the badge at once;
   - lister B can't read lister A's request, documents or upload keys; a non-admin and a
     `billing_admin` get refused by the document route and the actions; an admin can't approve
     their own request;
   - every step wrote its audit row, and update or delete on the audit log raises an error.
4. A browser walkthrough on local dev, in Edge, with the M-Pesa simulator:
   - a throwaway agent lister pays, uploads ID and EARB (PDF and JPEG), and submits;
   - the review is then done by an admin account you sign in with (see manual steps);
   - both pages are checked at 1280px and 390px, with 0 console errors and no overflow.
5. `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration` and `npm run build`
   pass.

## Checks to run

```bash
npm run db:generate          # creates 0006; re-run → "No schema changes"
npm run db:migrate           # dev
npm run typecheck && npm run lint && npm test
npm run test:integration     # test branch (or PGlite as in earlier slices)
npm run build
```

- Production migration: `DATABASE_URL_UNPOOLED=<prod direct> npx drizzle-kit migrate`, then push
  to deploy.
- The live site then gets the feature. Verification payments there use the Daraja sandbox, like
  listing plans do now.

## Manual test steps (after implementation)

1. Restart `npm run dev` (new migration and routes).
2. **Lister side:**
   1. Sign up a new test account and create a lister profile as **Agent**.
   2. Buy a Starter plan with the simulator (`npm run mpesa:pay`, as before).
   3. Open **Verification** in the account menu. Start verification and pay the verification
      plan the same way.
   4. Upload an ID (a JPEG or PDF) and an EARB certificate (a PDF). Try a `.txt` renamed to
      `.pdf`: it must be refused.
   5. Submit. The status reads "Under review".
3. **Admin side:**
   1. Sign in with your admin account and open **Admin console → Verification**.
   2. Open the request. Click **View** on each document: it opens in a new tab.
   3. Try **Approve** without ticking the checklist: it stays disabled. Tick all 4 and approve.
4. **Results:**
   - Back as the lister, Verification shows "Profile verified", with an expiry date a year away.
   - In Explore, the lister's listings come first under Recommended. The detail page shows the
     badge and the phone number.
5. **Rejection:** repeat with a second test lister, but choose **Request changes** (the lister
   sees the reason and re-uploads), then **Reject**.
   - The lister's billing page shows the listing plan extended by the credited days.
   - **Admin → Billing** shows the credit in the audit list.
6. **Live site:**
   - After I push, the same flow works on https://verifiedpropertieske.vercel.app with the
     Daraja sandbox (KES 1 verification plan).
   - Uploading there also exercises the private bucket on the production branch.
