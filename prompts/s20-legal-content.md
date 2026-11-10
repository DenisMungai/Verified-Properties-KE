# S20 Legal and content (Phase 4, part 2)

## Goal

Publish the documents and processes plan §12 "Compliance and content" requires before launch:

1. **Privacy notice** (`/privacy`), written against the Kenya Data Protection Act 2019.
2. **Terms of use** (`/terms`), including the badge-suspension right that plan §4 says "the terms
   must say".
3. **Subscription and refund policy** (`/subscription-policy`): periods, grace, pausing, upgrades,
   rejected-verification refund or credit, and how to raise a refund or dispute.
4. **Moderation and reports** (`/moderation`): what gets reviewed, how to report, what happens
   next, and how to appeal.
5. **A data-request route** (`/privacy/request`):
   - signed-in users file an access, correction, deletion, objection or other request
   - platform admins handle it at `/admin/data-requests`
6. **Links everywhere they're needed:**
   - footer links to all four documents
   - sign-up and checkout link to the terms and policy
   - the badge on the listing page links to what verification checks
7. **No dead links.** A test fails if a header, footer or legal-page link points at a page that
   doesn't exist.

The wording is plain-English technical guidance written from how the app actually works. **It is
not legal advice.** You (or a lawyer) review it before launch. The pages show a "Draft" notice
until you set an effective date.

**Out of scope:**
- eTIMS and VAT wording (your accountant, S23)
- cookie banners (the app sets only its own sign-in cookie; decision 6)
- automatic account deletion (decision 9)

## References read

- `docs/implementation-plan-v2.md`:
  - §4 billing rules, lapse table and paid-verification rules ("Admins can suspend a badge … The
    terms must say this"; "rejected reviews … refunded or credited")
  - §5 ranking and disclosure
  - §6 data model (`billing_audit_log`, invoices)
  - §10 retention and the Data Protection Act
  - §12 Compliance and content
  - §15 checklist (Operations: "Privacy notice, terms, subscription and refund policy,
    moderation process published")
  - §16 defaults
- `AGENTS.md`:
  - §1 design rules: compact type scale, `PageContainer width="text"`, tokens, 44px targets
  - §6 trust rules: never fake verification
  - §8 security
- `docs/SECURITY_TESTS.md`: the route-guard scan new pages and actions must pass

## Existing code inspected

- **`src/components/layout/SiteFooter.tsx`:** Explore, How it works, Pricing, plus account
  links. Its comment says real links only (plan §12).
- **`src/components/layout/nav.ts`:** `MAIN_NAV` (Home, Explore, How it works, Pricing) and
  account links.
- **`src/app/how-it-works/page.tsx`:**
  - already explains what "Profile verified" checks, costs and doesn't mean, how search ranking
    and home featuring work, and document retention
  - reads `RETENTION_*`, `REVIEW_*`, `GRACE_DAYS` and the ranking constants
  - its `Section` pattern and `max-w-prose` layout are the template for the new pages
- **Paid-ranking disclosure:**
  - `ResultsHeader.tsx` links `HOW_RANKING_WORKS_HREF` and `ShowcaseSection.tsx` links
    `HOW_FEATURED_WORKS_HREF`. Search is covered.
  - **The badge on the listing detail page (`properties/[slug]/page.tsx:153`) links nowhere.**
    That's the gap for "linked from … the badge".
- **`src/components/auth/SignUpForm.tsx:66`:** "Our terms and privacy notice will be published
  before launch." It gets replaced.
- **Facts the documents state** come from code, never retyped:
  - `src/lib/billing/constants.ts`: `BILLING_PERIOD_DAYS` 30, `GRACE_DAYS` 3
  - `src/lib/verification/retention.ts`:
    - documents deleted 90 days after a review ends or is declined
    - 24 months after a suspension
  - `src/lib/verification/rules.ts`: 12-month review validity, 2-working-day target
- **Cookies:** Better Auth sets the `vpk` session cookies (`auth-config.ts`). There's no
  analytics or tracking library (`package.json`, `src`).
- **Where data lives:**
  - Neon Postgres and Neon Object Storage: Frankfurt, `aws-eu-central-1`
  - Vercel: `fra1`
  - Upstash Redis and QStash: EU
  - Safaricom Daraja (M-Pesa)
  - Paystack (cards; optional)
  - Resend (email; not configured yet)
  - Africa's Talking (SMS; optional)

  All of these appear in the notice.
- **Rate-limit keys** are hashed IPs and user ids. View counts store a hashed visitor key.
- **No account-deletion or data-request code exists.**

## Decisions and assumptions

1. **Operator facts live in one file.** `src/lib/legal.ts` holds everything only you can supply:

   ```ts
   export const LEGAL = {
     operatorName: null,          // legal name of the business or person running the site
     contactEmail: null,          // a monitored address for privacy, billing and moderation
     postalAddress: null,         // Kenyan postal or physical address
     odpcRegistration: null,      // Data Protection Commissioner registration number, if registered
     effectiveDate: null,         // "2026-12-01" once reviewed; null shows the Draft notice
   } as const;
   ```

   Pages read it. A `null` fact shows a neutral line ("Contact us through the request form
   below") instead of a placeholder like `[TBC]`. Until `effectiveDate` is set, every legal page
   shows the Draft notice (UI spec). Nothing is invented: no company name, no address, no
   registration number.
2. **Numbers come from code.**
   - Periods, grace, retention, review validity and the review target import their constants.
   - Prices are never written into the documents; they link to `/pricing`.
   - Changing a rule changes the document.
3. **The privacy notice covers what the Act asks a notice to cover (s. 29):**
   - who we are
   - what we collect, by category: account, lister profile, listings and photos, verification
     documents, payments, messages and inquiries, saved listings, views, technical data
   - why, and on what basis: contract, legal obligation, legitimate interest, consent for
     optional SMS
   - who we share with: processors by name and purpose, plus other users per the contact rule
   - transfers outside Kenya: stored in the EU (Frankfurt), with the safeguards relied on
   - how long we keep it: from code, plus "payment records as long as Kenyan tax law requires
     (at least 5 years)", flagged for your review
   - your rights (s. 26), how to use them (the request route), complaints to the ODPC
   - security
   - under-18s may not open accounts
   - cookies
   - changes
4. **The terms cover:**
   - who may use the site, and accounts
   - listers' duties: accurate, lawful listings they have the right to publish; their own
     photos; no misleading prices or locations
   - prohibited content and conduct
   - moderation and takedown, linking `/moderation`
   - **verification**:
     - what the badge means and doesn't
     - payment alone never verifies
     - **we may suspend a badge for fraud or abuse at any time, whether or not the lister has
       paid** (plan §4)
   - **paid ranking**: verified listers rank first; it's disclosed and reorders only listings
     that match
   - messaging rules
   - subscriptions, by reference to the policy
   - our liability limits, as a marketplace that isn't party to property deals
   - ending accounts
   - Kenyan law
   - changes
5. **The subscription and refund policy** follows plan §4 and the implemented behaviour, linking
   `/pricing` for prices:
   - 30-day periods from a confirmed payment
   - manual renewal by M-Pesa STK, Paybill or card
   - reminders
   - 3-day grace, then listings pause; restored on renewal up to the plan limit
   - upgrade at once with unused days credited; downgrade at period end
   - verification add-on lapse rules
   - **rejected verification: the first month's verification fee is credited to the listing plan,
     or refunded** (as built in S12 and S13)
   - wrong-amount and duplicate payments are flagged and resolved by billing admins
   - **refunds and disputes go through the request route** ("Billing or refund question") or the
     contact email. A billing admin answers within the target in decision 8.
6. **Cookies.** Only the strictly necessary sign-in cookies are set, with no analytics or tracking.
   The notice says so, and there's no banner.

   If an analytics tool is ever added, it needs a consent step; the notice says that too.
7. **Data requests (new, small):**
   - **Table** `data_requests`:
     - `id`
     - `user_id`, referencing users
     - `kind`: `access | correction | deletion | objection | billing | other`
     - `details`: text, 10–2000 characters
     - `status`: `open | closed`
     - `resolution_note` (≤ 1000 characters)
     - `closed_by` and `closed_at`
     - `created_at`
     - index (`status`, `created_at`)
   - **Constraints:**
     - kind and status checks, plus the length checks
     - closed means `closed_by` and `closed_at` are set
   - **Migration:** `0011_data_requests`. No other schema change.
   - **Form** at `/privacy/request`:
     - Signed-in, verified users only, through `requireUser`. Signed-out visitors see "Sign in to
       make a request", plus the contact email if one is set.
     - The identity is the session, so no ID documents are asked for.
     - Zod-validated.
     - Rate-limited by `POLICIES.dataRequestPerUser`: 3 a day.
     - Confirmation shows the request reference (the first 8 characters of the id) and the
       response target.
     - The user's own open and closed requests are listed under the form.
   - **Admin** `/admin/data-requests`:
     - `AdminGate` with `["platform_admin"]`; the page and its action call `requireRole`.
     - Lists open requests first, with the user's name and email (admin-only), kind, details and
       age.
     - "Close with a note": Zod, at most 1000 characters, `closed_by` from the session.
     - An "Open data requests" count on `/admin` and an "Data requests" item in the admin nav.
   - **Out of scope:** no email notifications, because Resend isn't configured. The admin count is
     the signal; S21 can add an alert.
8. **Response targets:**
   - Privacy requests are answered within 7 days, which is inside the Act's 14-day window for
     most rights. Flagged for your confirmation.
   - Billing and refund questions within 2 working days, matching the verification target.
   - The targets are constants in `src/lib/legal.ts` and are shown on the pages.
9. **Deletion is a request, not a button.**
   - Payment, invoice and audit records are append-only, and Kenyan tax law requires keeping
     them. So a deletion request is handled by an admin: they remove or anonymise what can go,
     and tell the user what must stay and why.
   - The notice says this plainly.
   - A self-serve delete is a later decision; it's listed in the report.
10. **The badge link.**
    - On the listing detail page, the badge is followed by a small "What this means" link to
      `/how-it-works#verification`.
    - On cards, the badge stays unlinked: cards are already one link, and a link can't sit inside
      another.
    - The search results header already links to the ranking explanation.
11. **Dead-link test.** New `src/app/links.test.ts`. A static scan that collects:
    - `MAIN_NAV`, the footer link arrays and `accountLinks()` for every role mix
    - every literal internal `href="/…"` in `src/components/layout/**`, the four legal pages,
      how-it-works and pricing

    It then checks that each path, with its `#fragment` and query removed, matches a
    `src/app/**/page.tsx` route (route groups ignored, dynamic segments matched). It also checks
    that each `#fragment` exists as an `id=` on the target page when that page is one of the
    scanned files.
12. **Branch:** `s20-legal-content`, from `main`.

## Amendments during implementation (2026-11-10)

- **A1. Invented clauses removed from the terms.** Two clauses were drafted, then removed,
  because they are decisions for you or a lawyer, not facts from the app:
  - "a suspension is not refunded"
  - a 3-month liability cap

  The terms now state only what the code does: a suspension ends the verification plan.
- **A2. Softened privacy wording.** "Data stored outside Kenya" no longer claims the EU's
  protection is "at least equal" to Kenya's. "Changes" promises to let users know, with no claim
  of an in-site banner, which doesn't exist.
- **A3. No listing or report response time** is promised, because no target exists in the plan.
  Only the 2-working-day verification target is stated.
- **A4. The contents list is two columns from `sm`.** One column was too tall on desktop (11
  items at 44px).
- **A5. The admin data requests page uses stacked cards at every width**, matching
  `/admin/reports`, which has no table.
- **A6. `AlsoContact`.** Contact lines show an email or address only once those facts are set,
  so the text never repeats "use the request form".
- **A7. Signed-in walkthrough not run here.** A local production build can't sign in without
  real Upstash. The signed-in form and the admin close flow are proven by
  `data-requests.integration.test.ts` and the action scans. They are manual steps 5–6.

## Files likely to change

- New pages: `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`,
  `src/app/subscription-policy/page.tsx`, `src/app/moderation/page.tsx`,
  `src/app/privacy/request/page.tsx` (+ `actions.ts`).
- New admin page: `src/app/admin/data-requests/page.tsx` (+ action in `src/app/admin/actions.ts`).
- `src/components/legal/LegalPage.tsx`: shared layout, table of contents, Draft notice, "Last
  updated", `Section`.
- `src/components/legal/DataRequestForm.tsx` (client form).
- `src/lib/legal.ts`: facts, targets, request kinds and labels.
- `src/lib/validation/data-request.ts` (+ tests).
- `src/db/schema.ts`, `drizzle/0011_data_requests.sql` and meta.
- `src/db/queries/data-requests.ts` (+ `data-requests.integration.test.ts`).
- `src/lib/rate-limit.ts` (`dataRequestPerUser`).
- `src/components/layout/SiteFooter.tsx`, `src/components/admin/AdminNav.tsx`,
  `src/app/admin/page.tsx` (count).
- `src/components/auth/SignUpForm.tsx` (agreement line with links).
- Checkout: `src/components/billing/CheckoutForm.tsx` or the checkout page (one policy line).
- `src/app/properties/[slug]/page.tsx` (badge link).
- `src/app/links.test.ts` (new); `src/app/route-guards.test.ts` (the new admin page count, 12 →
  13).
- `docs/SECURITY_TESTS.md`: one line noting the new action is covered by the scan.

## Implementation requirements

1. **Content first.**
   - Write each document as typed sections in its page (not markdown files), so constants
     interpolate.
   - Sentences are short, in plain English, and say "we" and "you".
   - Every rule the code enforces matches the code. Where the code has a constant, the text uses
     it.
2. **Shared `LegalPage`:**
   - Props: `{ eyebrow, title, intro, sections: { id, title, body }[], updated }`.
   - It renders the Draft notice when `LEGAL.effectiveDate` is null, and otherwise "In force from
     {date}" in Nairobi time.
   - The table of contents uses anchor links, and the sections use `scroll-mt-24`.
   - The pages are static (no request-time data), so they prerender.
3. **Data requests:**
   - The query layer is scoped by user id for the user's own list.
   - Admin reads are only reachable from the admin page.
   - Closing is an `update … where status = 'open'` returning a row, so closing twice changes
     nothing.
   - Integration tests:
     - a user creates a request and lists only their own
     - another user can't see it
     - an over-length or empty `details` is refused
     - closing sets `closed_by` and `closed_at` once; a second close is a no-op
     - the 4th request in a day is refused (rate-limit policy unit test)
4. **Migration:**
   - Run `npm run db:generate` and review the SQL.
   - Apply it to the Neon **test** and **dev** branches with `npm run db:migrate`, printing the
     host label first.
   - **Production is yours, before the push that merges this** (manual steps).
5. **Footer:**
   - A second link row, "Legal", with Privacy, Terms, Subscriptions & refunds, and Moderation.
   - Same link style.
   - It wraps on phones in the existing two-column grid.
6. **Sign-up line:** "By creating an account you agree to our [Terms] and confirm you've read our
   [Privacy notice]." Links open in the same tab.
7. **Checkout line**, under the pay button, in `text-micro text-slate-600`: "Plans renew manually
   every 30 days. See our [subscription and refund policy]." The number comes from
   `BILLING_PERIOD_DAYS`.
8. **Badge link:**
   - `text-small text-emerald-700 underline-offset-4 hover:underline`, `min-h-control` hit area,
     next to the badge.
   - Its accessible name is "What Profile verified means".
9. **No new secrets or env variables.**

## UI specification

- **Layout:**
  - `PageContainer width="text"` with `pb-8 pt-6`
  - an `article` with `mx-auto max-w-prose flex flex-col gap-8`, the same as `how-it-works`
- **Header:**
  - eyebrow: `text-micro font-semibold uppercase tracking-wide text-emerald-700` ("Legal")
  - H1: `text-display-sm`
  - intro: `text-body text-slate-700`
  - "Last updated {date}": `text-micro text-slate-600`
- **Draft notice:** under the header.
  - A `rounded-lg border border-line bg-mint-50 p-5` panel.
  - Its `text-small` reads: "Draft. This document is being reviewed and isn't in force yet. It
    describes how VerifiedPropertiesKE works today."
  - It has no icon-only meaning and uses no colour alone.
- **Contents:** a `nav aria-label="On this page"` with a `text-small` list of anchor links in
  `text-emerald-700`, each a 44px row (`min-h-control`), in one column.
- **Sections:**
  - H2 `text-title`
  - body `text-body text-slate-700`, `gap-3`
  - lists `list-disc pl-5` with `gap-2`
  - no tables wider than the prose. Where a list of processors is needed, it's a list of
    `rounded-sm border border-line bg-white p-3` items, like how-it-works' document list.
- **Data request page:**
  - The same header.
  - **Form card:** `rounded-sm border border-line bg-white p-5`, with:
    - "What do you want to do?", a radio group of the six kinds; each option is a 44px row with
      label text
    - Details, a `Textarea` with a 2000-character limit and a counter in `text-micro`
    - a primary button, "Send request"
  - **Success:** a `FormAlert` reading "Request {ref} received. We'll reply within {N} days by
    email."
  - **Your requests:** a list of `rounded-sm border border-line p-3` rows showing kind, date,
    status chip (Open / Closed) and the resolution note when closed.
  - **Signed out:** a `bg-mint-50 rounded-lg p-5` panel, "Sign in to make a request…", with a
    secondary button to `/sign-in?next=/privacy/request`, plus the contact email if set.
- **Admin data requests:**
  - Under `AdminGate`, like the other admin pages.
  - A table on `lg` (name, email, kind, age, details, action), collapsing to stacked
    `rounded-sm border` cards below `lg`, matching `/admin/reports`.
  - "Close" opens an inline form: a note `Textarea` and a "Close request" button.
- **Phones (< 640px):** no horizontal scroll, the global type sizes, 16px inputs. The footer's legal
  row wraps in two columns.
- **Tokens only:** no navy, no shadows, the compact radii from `AGENTS.md`.

## Security requirements

- **The request action:** `requireUser`, Zod, rate limit (fails closed), typed errors. The user
  id comes from the session, never the form.
- **Admin page and close action:** `requireRole(["platform_admin"])` and `AdminGate`. The
  route-guard scan covers both automatically.
- **Requests:** a user only ever sees their own. Admin-only fields (another user's email) never
  reach non-admin pages; the exposure guard pattern is used in the integration test.
- **Wording:**
  - Never promise what the code doesn't do: no "we never store X" unless that's true.
  - Never state a registration number, company name or address we don't have.
- **No personal data in logs:** error names only.

## Acceptance criteria

- The four documents render at their routes with:
  - the Draft notice while `effectiveDate` is null
  - every number matching the code constants
  - no invented operator facts
- The footer shows the four legal links on every public page. The sign-up and checkout lines link
  correctly. The listing badge links to `/how-it-works#verification`.
- A signed-in user can file a request and see it listed. A second user can't see it. A platform
  admin sees it at `/admin/data-requests`, closes it with a note, and the user sees "Closed" with
  the note.
- `links.test.ts` passes, and it fails when a footer link is pointed at a missing page (shown
  once during implementation).
- `route-guards.test.ts` passes with the new admin page (13 admin pages).
- Migration 0011 is applied on test and dev. Integration tests pass.
- `typecheck`, `lint`, `npm test`, `test:integration` and `build` pass. The security sweep passes
  with the new routes included.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (after 0011 is on the test branch)
- `npm run build`, then the sweep: start the build with
  `UPSTASH_REDIS_REST_URL=http://127.0.0.1:9 UPSTASH_REDIS_REST_TOKEN=sweep npx next start -p 3005`,
  then run `npm run security:sweep`
- Browser walkthrough (Edge, `playwright-core@1.56.1`) against `npm run dev`, at 1280px and
  390px:
  - the four pages
  - the footer
  - the request form, signed in and signed out
  - screenshots for you

## Manual test steps (after implementation)

1. **Facts for `src/lib/legal.ts`:** send me, or fill in yourself:
   - the operator's legal name
   - a monitored contact email
   - a Kenyan postal or physical address
   - your ODPC registration number, if you have one

   Leave `effectiveDate` null until a lawyer or you have reviewed the text.
2. Run `npm run dev`. Open `/privacy`, `/terms`, `/subscription-policy` and `/moderation`.
   - Each shows "Draft…", a contents list that jumps to sections, and correct numbers: 30 days,
     3 days grace, 90-day document deletion.
3. **Footer:** scroll to the bottom of the home page. It shows the "Legal" links, and each one
   opens.
4. **Request, signed out:** sign out and open `/privacy/request`. You see "Sign in to make a
   request".
5. **Request, signed in:**
   1. Sign in as a buyer and send an "access" request.
   2. You see "Request ABCD1234 received…" and the request under "Your requests".
   3. Try a 4th request in a day; it's refused with a "try again" message.
6. **Admin:**
   1. Sign in as your platform admin. `/admin` shows "Open data requests: 1".
   2. Open **Data requests**, close the request with a note.
   3. As the buyer, reload `/privacy/request`. It shows "Closed" with your note.
7. **Badge link:** open any listing by a verified lister. "What this means" next to the badge
   opens the verification section of How it works.
8. **Production migration, before merging and pushing.** You run this; I'll give the exact
   one-line command, which uses `PROD_DATABASE_URL_UNPOOLED` from `.env.local` and prints the host
   label `ep-summer-morning-b9otl4v9` first.
