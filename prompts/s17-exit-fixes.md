# S17 exit fixes (F1–F3)

## Goal

Close the three findings in `docs/PHASE2_REPORT.md`, so Phase 2 ends with no open items:

- **F1:** prove, with a test and one real view, that every admin view of a verification document
  writes a `view_document` audit row, and that nobody else can open a document.
- **F2:** a verification renewal by an approved lister writes a `pay` audit row (reason
  "renewal"). Plan §10 lists "pay" among the actions to audit.
- **F3:** the SAMPLE listing "PENDING REVIEW, should never appear publicly" goes back to
  `pending_review` on dev, so it's no longer public.

No new features, UI changes, schema changes or migrations.

## References read

- `AGENTS.md`:
  - §5: thin route handlers, logic in `src/lib/`
  - §6: payment alone never verifies
  - §8: every route validates input; typed errors
  - §9: checks
- `docs/implementation-plan-v2.md` §10: "every document view, decision and payment is in the
  verification audit log"
- `docs/PHASE2_REPORT.md`: findings F1–F3
- `prompts/s12-verification.md`:
  - decision 7: document views go through an admin-only route that audits first, then hands out
    a short presigned link
  - decisions 3–5: paying with an unexpired approved review only renews the badge subscription

## Existing code inspected

- **`src/app/admin/verification/documents/[documentId]/route.ts`:**
  - returns 404 unless the session is a verified-email `platform_admin`
  - looks the document up (`getDocumentWithLister`, which already returns null for a non-UUID id)
  - writes the `view_document` audit row (reason `"<documentType> <documentId>"`) in its own
    transaction
  - then returns a 303 to a 60-second presigned GET on the private bucket
  - returns 503 if either of those last two steps fails
  - **why it has no test:** the logic sits in the route and imports `getCurrentUser`, `getDb`,
    `withTransaction` and `getPrivateStore` directly, so no test can supply them
- **`src/lib/verification/purchase.ts` `onVerificationPaid`:** runs inside the payment-confirmation
  transaction (`src/lib/mpesa/confirm.ts`). With an unexpired verified request it returns
  straight away, which is why a renewal leaves no audit row (F2).
  - A repeated callback can't reach it twice: `confirmPayment` returns `not_pending` for a
    payment that is no longer pending.
- **`src/lib/verification/rules.ts`:** `AUDIT_LABELS.pay` is "Payment confirmed".
  - The admin review page (`src/app/admin/verification/[id]/page.tsx`) shows each audit row's
    reason under its label, except for `view_document`, `upload` and `remove_document`. A
    renewal would read "Payment confirmed — Renewal".
- **`src/lib/verification/verification.integration.test.ts`:**
  - transaction per test with savepoints, an in-memory private store
    (`createMemoryStore().presignGet`)
  - helpers `submitted`, `payForVerification`, `auditActions`
  - the existing test "a lapsed verification payment hides the badge; renewing restores it with no
    new review" covers the renewal path F2 touches
- **Seed (`src/db/seed/seed.ts`):**
  - `--remove` **archives** any sample listing that has a moderation-log row, rather than deleting
    it
  - a re-seed then skips it because its slug already exists
  - so re-seeding would leave this listing archived, not `pending_review`, and `--remove` would
    also expire the sample verified listers
  - **Conclusion:** re-seeding, as the report suggested, is the wrong fix.

## Decisions and assumptions

1. **F1: move the route's logic into a function the tests can call.** The new module is
   `src/lib/verification/document-view.ts`:

   ```ts
   openDocumentForAdmin(
     deps: { db; withTransaction; privateStore },
     viewer: { id; emailVerified; roles } | null,
     documentId: string,
   ): Promise<{ ok: true; url: string } | { ok: false; code: "not_found" | "unavailable" }>
   ```

   - The behaviour stays exactly as it is today:
     - the same admin check and lookup
     - the audit row is written first, in its own transaction
     - a 60 s presign
     - `unavailable` when the audit write or the presign throws, logged with the error name only
   - The route stays thin:
     - it reads the session
     - it calls the function with `getListerDeps()`, which already has `db`, `withTransaction` and
       `privateStore`
     - it maps the result to a 303 (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`), a
       404 or a 503
   - An admin opening their own documents stays allowed. Only deciding on your own request is
     refused, as in S12.
2. **F1, the one real view:** after the code lands, you open one of the agent's documents from
   `/admin/verification/8dbd9630-4294-4cad-99ff-8276a2c23c3f` on dev. I check that request's
   history for a new `view_document` row.
3. **F2: renewals are audited.** In `onVerificationPaid`, when an unexpired verified request
   exists, write
   `insertAudit(tx, { requestId: verified.id, actorUserId: userId, action: "pay", reason: "Renewal" })`,
   then return.
   - Because it's inside the confirmation transaction, it commits with the payment or not at all.
   - Repeated callbacks never reach it (see code inspected).
   - The suspended and open-request branches are unchanged.
   - No new audit action and no schema change.
4. **F3: a one-row update on the dev branch** (`br-ancient-pine-b91b3kvl`) only, through Neon
   `run_sql`:

   ```sql
   update properties
      set status = 'pending_review', published_at = null, reviewed_at = null
    where slug like 'sample-%'
      and title = 'PENDING REVIEW, should never appear publicly'
      and status = 'published'
   returning id, slug, status;
   ```

   - **Pass:** it returns exactly one row. If it returns none or several, I stop and tell you.
   - The append-only moderation log keeps its 5 Nov approval row; this fix adds no log row.
   - The listing returns to the moderation queue. **Please don't approve it again.**
   - If the auto-mode classifier blocks the write, I give you the SQL to run in the Neon console.
   - **Why not re-seed:** see "Existing code inspected".
5. **Report:** `docs/PHASE2_REPORT.md` gets a "Closed in s17-exit-fixes" status on F1–F3, with the
   evidence (test names, the view's audit row, the F3 row id). Its next-steps list is updated.

## Files likely to change

- `src/lib/verification/document-view.ts` (new)
- `src/app/admin/verification/documents/[documentId]/route.ts` (made thin)
- `src/lib/verification/purchase.ts` (F2)
- `src/lib/verification/verification.integration.test.ts` (new and extended cases)
- `docs/PHASE2_REPORT.md` (findings closed)

## Implementation requirements

1. **`document-view.ts`:**
   - `import "server-only"`, explicit types, no `any`
   - the deps type reuses `ListerDeps`' fields, picked from that type rather than redeclared
   - `LINK_SECONDS = 60` moves here
   - **order:** check the viewer → look up the document → write the audit row → presign
   - when the viewer isn't a verified-email `platform_admin`, return `not_found` before any
     database read
2. **Route:**
   - only reads the session, calls the function and maps the result
   - status codes and headers as today
   - the doc comment moves to the function, and the route points at it
3. **`onVerificationPaid`:** the renewal audit row from decision 3. Update the function's doc
   comment.
4. **Tests,** in `verification.integration.test.ts`, using the suite's memory store and
   savepoints. New `it("audits every admin document view and hides documents from everyone else")`:
   - **Admin:** opening one of a submitted lister's documents returns `ok` with the memory store's
     URL. Exactly one new `view_document` row, actor = the admin, reason
     `"<type> <documentId>"`. A second open writes a second row.
   - **Refused, each `not_found` with no audit row added:**
     - the lister themself (no admin role)
     - another lister
     - `null` (signed out)
     - an admin whose email isn't verified
     - an unknown UUID
     - a non-UUID string
   - **Presign fails** (a store whose `presignGet` throws): `unavailable`.
5. **Extend the existing renewal test:**
   - after `payForVerification` renews, the audit ends with `pay` and that row's reason is
     `"Renewal"`
   - still exactly one request, still `verified`
   - confirming the same payment again adds no row (`not_pending`)
6. **No other changes.** Existing expectations of the audit order (`["start", "pay", ...]`) must
   still hold for first-time payments.

## Security requirements

- **Document route:**
  - Still 404 for everyone except verified-email platform admins.
  - Never reveals whether a document exists.
  - Never returns the storage key or a link without first writing the audit row.
  - `no-store` and `no-referrer` stay.
- **Logs:** error names only, with no document ids, keys or personal data.
- **Payment:** a renewal still never changes review status, review expiry or the badge rule.
  Only the audit row is new.
- **F3:**
  - The write touches the dev branch only. The `where` clause pins the SAMPLE slug, title and
    current status.
  - No production access.
- **Roles:** none granted by script. The admin view in decision 2 is done by you.

## Acceptance criteria

- The new F1 test and the extended renewal test pass, and every other verification test still
  passes.
- Opening a document as admin on dev adds one `view_document` row to that request's history,
  shown as "Document viewed" on the review page.
- A verification renewal adds one "Payment confirmed — Renewal" row. A first payment still logs
  `pay` with no reason.
- The F3 listing is `pending_review` on dev. It's absent from search and home and shows in
  `/admin/listings` moderation.
- `docs/PHASE2_REPORT.md` shows F1–F3 closed, with the evidence.
- `typecheck`, `lint`, `npm test` and `build` pass. The verification integration file passes, and
  so does the full integration suite.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration -- verification`, then the full `npm run test:integration`
- `npm run build` (a route changed)

## Manual test steps (after implementation)

1. Start dev with `npm run dev` and sign in as your platform admin.
2. Open `/admin/verification/8dbd9630-4294-4cad-99ff-8276a2c23c3f`:
   1. Click "View" on either document. The file opens through a short-lived link.
   2. Reload the review page. History shows a new "Document viewed" entry with your name.
3. Sign out, or use a private window, and paste the document URL from step 2. You get a 404.
4. Open `/properties?mode=rent` and the home page. "PENDING REVIEW, should never appear publicly" is
   no longer shown.
5. Open the admin moderation queue (`/admin/listings`). That sample listing is waiting there. Leave it pending.
6. *(Optional)* The renewal row needs a renewal payment. The integration test covers it. To see it
   live on dev:
   1. Run `npm run mpesa:pay` for the verification plan on a verified walkthrough lister.
   2. Run `npm run mpesa:simulate`.
   3. The review's history shows "Payment confirmed — Renewal".
