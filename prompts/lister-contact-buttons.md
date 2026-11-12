# Lister contact buttons: Call, WhatsApp and Email

## Goal

Listers add a phone number, an optional WhatsApp number and an optional public email to their
profile. Finders reach them from a listing with one tap: **Call** (`tel:`), **WhatsApp**
(click-to-chat with a pre-filled message about the listing) and **Email** (`mailto:` with the
listing in the subject), like BuyRentKenya.

The owner chose this visibility rule on 2026-11-12. It replaces the plan §16 default "Verified
listers' phone numbers public; others hidden until a signed-in inquiry":

| Lister | Signed-out visitor | Signed-in visitor (verified email) |
|---|---|---|
| Verified | Call, WhatsApp, Email | Call, WhatsApp, Email |
| Not verified | "Sign in to see contact details" | Call, WhatsApp, Email (no inquiry needed first) |

Verification still sells "your contacts are open to every visitor". The inquiry form stays for
signed-in buyers who prefer to message on the site.

**Out of scope:**
- WhatsApp Business Platform messages or notifications (plan Phase 5)
- counting contact taps for lister stats (a possible follow-up)
- creating agencies or managing their members in the app (agencies are still created by an
  operator, as today); this slice only lets an agency admin edit the agency's contact details

## References read

- `AGENTS.md` §1 design rules (h-control 44px targets, six type sizes, tokens, `data-mobile-bar`),
  §6 "Contact" business rule, §8 security, §9 checks
- `docs/implementation-plan-v2.md`: §1 verification benefits ("public phone numbers"), §5
  verification lapse row (public phone removed with the badge), §8 S8 contact form notes, §14
  "Trust signals", §16 "Contact details" default, Phase 5 "WhatsApp" (Business Platform, not this)
- Design folder `03 — Property Detail`: the sticky right card holds price, lister and contact. The
  design has no WhatsApp/Call buttons, so they use the existing `Button` styles
- BuyRentKenya listing pages, as the owner's reference for the interaction (buttons, not text)

## Existing code inspected

- `src/lib/listings/contact.ts`: `contactVisibility` ("public" | "after_inquiry" | "hidden") and
  `visibleContact`; email is never shown before an inquiry. `contact.test.ts` pins the old rule.
- `src/app/properties/[slug]/page.tsx:115-127`: the rule runs on the server; `signedIn` is a user
  with a verified email; hidden details never reach the page. Lines 209-226: the mobile bottom bar
  (`data-mobile-bar`) with price and a "Contact lister" jump to `#contact`.
- `src/components/listing/ListerPanel.tsx`: `ContactDetails` renders phone and email as text links,
  with "appears here after you send them a message" copy for hidden contacts.
- `src/db/queries/inquiries.ts:92` `getListerContact`: reads `lister_profiles.phone` and
  `public_email`.
- `src/db/schema.ts:217` `lister_profiles`: `phone` (E.164), `public_email`; no WhatsApp column.
  Latest migration `drizzle/0011_data_requests.sql`.
- `src/lib/validation/profile.ts` `listerProfileSchema`, `src/components/account/ListerProfileForm.tsx`,
  `src/app/account/actions.ts` (`PROFILE_FIELDS`), `src/app/account/profile-defaults.ts`,
  `src/db/queries/lister-profiles.ts`: the profile path for phone and email.
- `src/app/account/messages/[id]/page.tsx:33-39`: the conversation page shows the lister's phone
  and email to the buyer.
- Copy that states the old rule: `src/app/privacy/page.tsx:106`, the phone hint in
  `ListerProfileForm.tsx`, `src/components/verification/ListerStatus.tsx:112` ("buyers see your
  phone number"), `src/app/how-it-works/page.tsx:115`.
- `src/db/queries/public-exposure.integration.test.ts`: fails if a public query returns a column
  matching `email|phone|…`.

## Decisions and assumptions

1. **Visibility** as in the goal table. `contactVisibility` becomes
   `({ listerVerified, viewerSignedIn }) → "public" | "signed_in" | "hidden"`:
   - `public`: verified lister, any viewer
   - `signed_in`: unverified lister, signed-in viewer with a verified email
   - `hidden`: unverified lister, signed-out viewer

   Both visible states return phone, WhatsApp and email. The `hasInquired` check is no longer
   needed for contacts (it stays where the conversation link uses it).
2. **WhatsApp number:** new nullable `lister_profiles.whatsapp` (E.164), optional in the form,
   normalised like `phone` (Kenyan mobile only). Blank means no WhatsApp button. The form offers a
   "Same as my phone number" checkbox, ticked by default for new profiles. When ticked, the server
   stores the phone number as `whatsapp`; the field is hidden by the browser but still works
   without JavaScript (the checkbox wins on the server).
3. **Email** stays optional (`public_email`); blank means no Email button. The account email is
   never shown.
4. **Links:**
   - Call: `tel:+2547…`
   - WhatsApp: `https://wa.me/2547…?text=…` with
     `Hi, I'm interested in "<title>" on VerifiedPropertiesKE: <absolute listing URL>`, opening in a
     new tab (`target="_blank" rel="noopener noreferrer nofollow"`)
   - Email: `mailto:…?subject=Enquiry: <title>` with the listing URL in the body
   - Built by one pure helper `src/lib/listings/contact-links.ts`, unit tested (encoding, E.164 to
     `2547…`, titles with quotes, `&`, emoji)
5. **Buttons, not text.** Each is a 44px (`h-control`) button with a lucide icon and a text label
   ("Call", "WhatsApp", "Email"); the number shows under the buttons as text, so it can be read
   aloud or copied. No new colours: Call is the primary emerald button, WhatsApp and Email are
   secondary (outline) buttons. No WhatsApp brand green and no WhatsApp logo (trademark;
   lucide `MessageCircle` icon with the word "WhatsApp").
6. **Mobile bottom bar:** when contacts are visible, the bar shows price plus Call and WhatsApp
   icon-and-label buttons (WhatsApp only if set). Otherwise it keeps "Contact lister" →
   `#contact` (which shows the sign-in prompt).
7. **Conversation page** (`/account/messages/[id]`) gets the same three buttons from the same
   component, so buyers see one style everywhere.
8. **The inquiry form stays** under the buttons for signed-in buyers, introduced as "Or send a
   message on VerifiedPropertiesKE".
9. **AGENTS.md §6 "Contact"** is updated to the new rule, with the date and "owner decision". The
   plan (a transcription of the PDF) is not edited; this prompt records the change.
10. **Agency contacts (owner request, 2026-11-12).** `agencies` already has `public_phone` and
    `public_email`, but no screen writes them.
    - **New column** `agencies.whatsapp` (E.164, same check as `lister_profiles.whatsapp`). A check
      is added to `agencies.public_phone` too, after confirming the existing rows pass it.
    - **Editing:** a new "Agency contact details" form on `/account/profile`, shown only to an
      agency admin of that agency (`isAgencyAdmin`, the check billing uses). It has phone,
      WhatsApp (with "Same as phone") and email, all optional, and is saved by its own Server Action
      that re-checks the admin role on the server. Agency members who aren't admins see the
      details read-only.
    - **On a listing with an agency:** the panel shows the agent's own buttons first (the person
      handling the listing), then an "Agency office" row with the agency name and its Call,
      WhatsApp and Email buttons, for whichever are set. If the agent has no contacts at all, the
      agency row is the only one. A listing without an agency is unchanged.
    - **Visibility:** the same table applies, decided by the listing's lister (the verified badge
      belongs to the listing owner, plan §6). Agency details are hidden from signed-out visitors
      on an unverified lister's listing, like the agent's.
    - **Mobile bar:** Call and WhatsApp use the agent's numbers, or the agency's when the agent has
      none.
    - **Conversation page:** shows the agency row too.
11. **Verification lapse:** unchanged mechanics. A lapsed lister becomes "not verified", so their
    contacts fall back to signed-in only. The how-it-works copy says "contacts open to every
    visitor" instead of "public phone number".

## Files likely to change

- `src/db/schema.ts`, new `drizzle/0012_*.sql` (+ meta) via `npm run db:generate`
- `src/lib/listings/contact.ts`, `contact.test.ts`; new `contact-links.ts`, `contact-links.test.ts`
- `src/db/queries/inquiries.ts` (`getListerContact` adds `whatsapp`, and the agency's name and
  contacts when the listing has an agency)
- new `src/db/queries/agency-contacts.ts` (read and update, admin-scoped), new
  `src/lib/validation/agency-contact.ts`, new `src/components/account/AgencyContactForm.tsx`,
  `src/app/account/profile/page.tsx` and a new Server Action in `src/app/account/actions.ts`
- `src/lib/validation/profile.ts` (+ `validation.test.ts`), `src/app/account/actions.ts`,
  `src/app/account/profile-defaults.ts`, `src/db/queries/lister-profiles.ts`,
  `src/components/account/ListerProfileForm.tsx`
- new `src/components/listing/ContactButtons.tsx`; `ListerPanel.tsx`;
  `src/app/properties/[slug]/page.tsx`; `src/app/account/messages/[id]/page.tsx`
- copy: `src/app/privacy/page.tsx`, `src/app/how-it-works/page.tsx`,
  `src/components/verification/ListerStatus.tsx`
- `src/db/queries/public-exposure.integration.test.ts` (forbidden-column regex adds `whatsapp`)
- `src/db/seed/sample-data.ts` (sample listers get WhatsApp numbers, SAMPLE-labelled)
- `e2e/journey.spec.ts` step 6 and `e2e/visitor.spec.ts` (assert buttons per the table)
- `AGENTS.md` §6

## Implementation requirements

1. Migration adds `lister_profiles.whatsapp` and `agencies.whatsapp` (`text`) with a check that
   each is null or matches `^\+254[17]\d{8}$` (same shape as `phone`), plus the same check on
   `agencies.public_phone` once existing rows are confirmed to pass. Generated by `npm run db:generate`, applied with `npm run db:migrate`
   to dev; production gets it on the next deploy's migration step as usual.
2. The visibility rule and the links are pure functions with unit tests covering every row of the
   goal table, including an unverified lister viewed by a signed-in user with an unverified email
   (hidden).
3. The listing page still fetches contacts only when visibility is not `hidden`, and never for
   the lister's own listing (the own-listing note stays).
4. `ContactButtons` is a server component (no client JavaScript): plain anchors styled with
   `buttonClasses`. Buttons wrap to two rows at 320px without horizontal scroll.
5. Profile form: Zod v4 schema; errors announced as in S22 flow 8 (`aria-invalid`, described
   error, values kept after a failed submit, checkbox state kept).
6. Copy uses the six type sizes only (`small`, `micro` for hints), no `text-base/lg/xl`.
7. Signed-out prompt on unverified listings: button "Sign in to see contact details" plus the
   micro line "It's free. You'll come straight back to this listing."

## Security requirements

- The rule stays on the server. Hidden contacts never reach the HTML, RSC payload or props of a
  signed-out page for an unverified lister (checked by an e2e test reading the page source).
- Signed in means a verified email (`user.emailVerified`), as today, so throwaway unverified
  sign-ups can't harvest numbers.
- No new public query exposes contact columns; the exposure test enforces it.
- Only an agency admin of that agency can change its contacts. The Server Action takes no agency
  id from the browser: it finds the caller's agency on the server, checks the admin role, validates
  with Zod and applies the existing profile rate limit. An integration test proves a plain member
  and an admin of another agency are refused.
- `wa.me` links carry only the lister's number, the listing title and URL. No buyer data.
- Logs never print phone or WhatsApp numbers unmasked.
- Terms already forbid harvesting contact details (`terms/page.tsx:75`); privacy copy updated to
  say who sees what.

## Acceptance criteria

- A lister can save phone, WhatsApp (or "same as phone") and an optional email; bad numbers show
  accessible errors and keep the typed values.
- Each row of the goal table renders exactly as stated, on desktop and on the mobile bottom bar.
- An agency admin can save the agency's phone, WhatsApp and email. A listing under that agency
  shows the "Agency office" row under the agent's buttons, following the same visibility rule. A
  non-admin member can't change them.
- WhatsApp opens a chat with the lister's number and the pre-filled message; Email opens a draft
  with the subject; Call dials.
- Buttons are 44px tall, keyboard reachable, with visible focus and text labels; axe stays at 0
  violations on the listing and profile pages.
- Privacy, how-it-works, verification and profile copy match the new rule. AGENTS.md §6 updated.
- `typecheck`, `lint`, `test`, `test:integration` (migration and query change), `build` pass; the
  affected e2e specs pass.

## Checks to run

- `npm run db:generate`, `npm run db:migrate` (dev)
- `npm run typecheck`, `npm run lint`, `npm test`
- `npm run test:integration` (exposure, engagement, messaging, lister-profile files)
- `npm run build`
- `npm run e2e -- e2e/visitor.spec.ts e2e/journey.spec.ts e2e/forms.spec.ts e2e/a11y.spec.ts`
  (after a reset of the e2e branch, with your OK)

## Manual test steps (after implementation)

1. `npm run dev`. Sign in as a lister → Account → Profile. Leave "Same as my phone number" ticked,
   add a public email, save. Untick it, enter a different WhatsApp number, save. Enter `0712` and
   check the error.
2. Open one of your listings signed out:
   - lister not verified → "Sign in to see contact details", no number anywhere in the page
     (View source, search for `254`)
   - a verified sample lister's listing → Call, WhatsApp, Email visible
3. Sign in as a buyer and open an unverified listing → the three buttons show without sending a
   message first.
4. On your phone: open a listing, use the bottom bar's Call and WhatsApp. WhatsApp should open with
   the listing title and link filled in.
5. Tap Email → your mail app opens with "Enquiry: <title>".
6. Agency contacts. The app can't create agencies yet, so I set up a SAMPLE agency on dev with you
   as its admin. Then:
   - Account → Profile → "Agency contact details": add the office phone, WhatsApp and email, save
   - open a listing under that agency: the "Agency office" row shows under the agent's buttons
   - sign in as a plain member of that agency: the agency details are read-only

## Amendments during implementation

1. **No seeded WhatsApp numbers.** The sample listers have no phone numbers on purpose, and a
   made-up Kenyan number could belong to a real person (AGENTS.md §6, never fake trust signals).
   `sample-data.ts` is unchanged; manual testing uses your own profile.
2. **New rate limit `agencyContactPerUser`** (20 an hour). The lister profile save has no rate
   limit to reuse, so the agency form gets its own.
3. **`getListingContact(db, propertyId)` replaces `getListerContact(db, ownerUserId)`.** It loads
   the owner's and the listing's agency contacts in one query, keyed by the listing. The page no
   longer needs `hasInquired` for contacts.
4. **The exposure test** forbids `whatsapp` keys too, and uses valid, unique E.164 markers for the
   format-checked agency columns and lister WhatsApp.
5. **The validation tests' duplicate contact-rule block** (`engagement.test.ts`) was removed; the
   rule's tests live in `src/lib/listings/contact.test.ts`.
6. **Existing profiles start with "same as phone" unticked** and no WhatsApp number, so nobody gets
   a WhatsApp button they didn't choose. New profiles start ticked.
7. **The e2e run used the e2e branch without a reset** (`E2E_SKIP_RESET=yes`); global setup still
   applied the new migration. Specs use per-run accounts and titles.
8. **Copy also changed in `src/app/subscription-policy/page.tsx`** (the verification lapse line
   named the "public phone number").
