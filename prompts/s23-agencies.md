# S23: Agencies (create, invite, manage, public agency pages)

## Goal

Agencies become a real part of the site instead of rows an operator types into the database.

1. **Any lister can create an agency** from their account and becomes its admin.
2. **Agency admins invite agents by email.** The invitee gets a link (valid 7 days), signs in or
   signs up with that email, and accepts. Nobody is added without agreeing.
3. **Admins manage the agency:** name, description, website, logo, office contacts, members
   (make admin, remove), pending invites (revoke).
4. **Members can leave.** Leaving or being removed takes the agent's listings with them.
5. **Public agency pages** at `/agencies/[slug]`: the agency's details, its team and all its
   published listings, linked from every listing under the agency.

Owner decisions (2026-11-12):

| Question | Decision |
|---|---|
| Scope | Account side and public pages |
| Who creates an agency | Any lister, self-service |
| How agents join | Email invite link |
| Joining with an own plan and live listings | Allowed, with a warning first: listings move into the agency, any over its limit are paused, the own listing plan is cancelled without a refund. The verification plan is kept |
| Leaving or being removed | Listings go with the agent: they leave the agency and the live ones are paused until the agent has their own listing plan |

**Out of scope:** an agency directory page (`/agencies`), agency-level verification or badges,
closing or deleting an agency, transferring listings between agents, admin-console agency tools,
WhatsApp notifications. Each is a possible follow-up.

## References read

- `AGENTS.md` §1 design rules, §5 layers, §6 entitlement ("an agency plan's limit is shared across
  its members"), payments, verified badge, lapse and trust-signal rules, §7, §8, §9
- `docs/implementation-plan-v2.md`: §2 (agents and agencies), §3 plan table (Agency: 100 listings,
  shared), §7 roles (`agency_admin`), §8 tables, S3 "agency-aware permissions", §13 Phase 5
  "Agency pages for verified agencies, with their team and all listings" (brought forward by the
  owner), §14 cross-cutting rules
- Design folder: no agency screens. Account pages follow `01 — Lister Dashboard` and
  `02 — Billing & Verification` (sidebar, panels, tables); the public page follows the search
  results grid (`02 — Search Results`) and the property card.
- `prompts/lister-contact-buttons.md` (agency office contacts, decision 10), `prompts/s6-billing-ui.md`
  (agency admin-only billing), `prompts/lister-avatars.md` (upload pipeline),
  `prompts/billing-cancel-delete-invoices.md` (`<details>` confirms, no popovers)
- Memory: the owner's phone browser has no Popover API, so confirms use `<details>`

## Existing code inspected

- `src/db/schema.ts`: `agencies` (name, unique slug, description, logo_key, website_url,
  public_email, public_phone, whatsapp), `agency_members` (PK agency+user, role admin|member,
  index on user), `lister_profiles.agency_id`, `properties.agency_id`, `subscriptions.owner_agency_id`,
  `plans.is_agency_plan`, `billing_audit_log`, `payment_events`
- `src/db/queries/billing.ts`: `getListingPool` (agency when the profile has `agency_id`),
  `countActiveListings` (agency pool counts `properties.agency_id`, user pool counts
  `owner_user_id`), `getPublishEntitlement`
- `src/db/queries/listings.ts:29-40`: listing access = owner, or an admin member of the listing's
  agency; `createDraft` copies the agency from the creator's profile; `lockPool`
- `src/db/queries/jobs.ts:46` `lockPoolActiveListings`; `src/lib/billing/plan-schedule.ts`
  (`listingsUsingSlots`, `applyKeepSelection`): how over-limit listings are paused today
- `src/db/queries/payments.ts`: `isAgencyAdmin`, `voidInvoices`, `cancelPendingSubscription`,
  subscription owners
- `drizzle/0002_billing.sql:192`: `verified_listers_now` already uses the agency's listing plan for
  agency members, so the badge follows the pool automatically
- `src/db/queries/agency-contacts.ts`, `AgencyContactForm.tsx`, `/account/profile` agency section
- `src/db/queries/public-listings.ts` (`filterConditions`, card columns, `listerAvatarKeySql`:
  agency listings show the agency logo), `listing-detail.ts` (`listerName` = agency name or
  display name), `ListerPanel.tsx`
- `src/db/queries/roles.ts` (`grantRoles`, `revokeRoles`), `lister-profiles.ts` (self-service role
  mapping), `src/lib/roles.ts` (`agency_admin` is a lister role)
- `src/lib/email/send.ts`, `templates.ts`; `src/lib/rate-limit.ts` `POLICIES`
- `src/app/account/profile/avatar-actions.ts`, `src/lib/storage/keys.ts`, `ingest.ts`
- `src/app/account/onboarding/page.tsx` (always redirects to the overview), sign-in `next`
  handling (`safeNextPath`, `carriedNext`)
- `src/components/layout/nav.ts` `accountLinks`
- `src/db/queries/public-exposure.integration.test.ts`

## Decisions and assumptions

1. **One agency per lister.** `lister_profiles.agency_id` stays the single link. A new unique
   index on `agency_members(user_id)` backs it up (after confirming dev and production have no
   user in two agencies). A lister already in an agency can't create or join another; they leave
   first.
2. **`agency_members.role` is the source of truth** for agency permissions (billing and listing
   access already read it). The `agency_admin` user role is kept in step in the same transaction:
   granted when someone becomes an admin, revoked when they stop being one. Nothing reads it for
   permissions.
3. **Creating an agency.** Form: name (2–80 chars), optional description (up to 1,000 chars).
   The slug is made from the name (`kebab-case`, max 60 chars, `-2`, `-3`… on collision) and never
   changes after creation. Renaming keeps the slug, so links don't break. The creator becomes an
   admin member. Creating moves the creator in exactly like accepting an invite (decision 5), so
   the same warning is shown first.
4. **Invites.**
   - Table `agency_invites`: id, agency_id, email (lower-cased), role (admin|member, default
     member), token_hash (SHA-256, unique), invited_by, expires_at (7 days), accepted_at,
     accepted_by, revoked_at, created_at. The raw token (32 random bytes, base64url) exists only in
     the email and in the one-time "Copy invite link" shown to the admin right after sending (so it
     can also be shared on WhatsApp).
   - One open invite per agency and email: re-inviting revokes the old one and sends a new link.
     At most 50 open invites per agency.
   - Inviting an email that already belongs to a member is refused with a clear message. Inviting
     someone who is in another agency is allowed; they must leave that one before accepting.
   - Link: `/account/agency/invites/<token>`. Signed-out visitors go through sign-in, which keeps
     `next`; the sign-in page's "Create an account" link carries `next` too, so a new user comes
     back to the invite after verifying their email.
   - **Accepting requires** a signed-in user with a verified email that matches the invite email
     (case-insensitive), an open unexpired invite, no current agency, and a lister profile. Without
     a profile the page links to `/account/onboarding?next=<invite path>`. Onboarding learns a safe
     `next` (via `safeNextPath`) and redirects there after saving.
   - A mismatched email sees "This invite was sent to w•••@example.com. Sign in with that email to
     accept it." (masked with `maskEmail`). Expired, revoked or used invites say so plainly.
   - Declining marks nothing on the agency side beyond `revoked_at` (the admin sees "Declined").
5. **Joining (create or accept), in one transaction:**
   1. Lock the invite row (accept only), the joiner's personal pool and the agency pool
      (`lockPool`), so parallel accepts can't overfill the agency.
   2. Insert the `agency_members` row and set `lister_profiles.agency_id`.
   3. Set `properties.agency_id` on all of the joiner's listings that aren't archived (drafts
      too), so the pools stay consistent with `countActiveListings`.
   4. Cancel the joiner's live personal **listing** subscription (status pending, active,
      past_due or paused → `cancelled`, `cancelled_at` = now) and void its open invoices
      (`voidInvoices`), so a late M-Pesa payment for it is flagged, not activated (existing rule).
      Write a `billing_audit_log` row (actor = the joiner, action `agency_join_plan_cancelled`,
      reason "Joined agency <name>") and a `payment_events` `status_change` row per voided invoice.
      The **verification** subscription is not touched.
   5. Fit the joiner's live listings (`published`, `pending_review`) into the agency's free slots:
      the agency's own live listings keep their places, then the joiner's most recently published
      fill what's left, and the rest become `paused` (the existing pause path, so they come back
      through the normal un-pause or renewal flow). With no agency plan, all of them are paused.
   6. Mark the invite accepted (`accepted_at`, `accepted_by`), and grant `agency_admin` if the
      invite role is admin.
6. **The warning before joining** is computed on the server from real numbers and shown on the
   create form and the accept page, for example: "You have 4 live listings and a Standard plan
   paid until 3 Dec 2026. When you join, your listings move to Acme Realty and use its plan (2 of
   100 places free), 2 will be paused, and your own listing plan ends today with no refund. Your
   verification is not affected." When there is nothing to lose, it says so briefly. The submit
   button reads "Join Acme Realty" or "Create agency".
7. **Leaving or removal, in one transaction:** delete the member row, set
   `lister_profiles.agency_id` to null, set `properties.agency_id` to null on the agent's
   listings, pause their `published` and `pending_review` listings, and revoke `agency_admin` if
   held. Conversations and inquiries stay with the agent (they already belong to the owner user).
   - The last admin can't leave or be demoted while other members remain ("Make someone else an
     admin first").
   - The only member can't leave in this slice ("Contact support to close the agency"), because
     the agency may own a subscription.
   - Admins can't remove themselves through "Remove"; they use "Leave".
   - A removed agent gets an email: "You're no longer part of <agency>. Your listings are paused
     until you have your own listing plan" with a link to billing.
8. **Agency admins** can edit name, description, website (https only, max 200 chars, shown with
   `rel="nofollow ugc noopener"`), logo and office contacts; invite and revoke; make a member an
   admin or a member; remove members. They already pay the agency plan and can edit every agency
   listing. Plain members see the agency, the team and the office contacts read-only, and can
   leave.
9. **Logo upload** reuses the avatar pipeline (presigned private upload → verify → `processAvatar`
   variants → public bucket) with its own keys: uploads `uploads/agency/<agencyId>/<uuid>`, base
   `agency-logos/<agencyId>/<uuid>`. Only an admin of that agency may request or finalize; the
   agency id is never taken from the browser (it's the caller's own agency). The old logo's
   objects are deleted after the row points at the new one, as for avatars.
10. **Account UI:** a new "Agency" item in the account nav for listers, at `/account/agency`.
    - Not in an agency: invites addressed to the user's email (Accept/Decline links), then
      "Create an agency" with the decision 6 warning.
    - In an agency: the agency card (logo, name, link to the public page when it has published
      listings), office contacts (the `AgencyContactForm` moves here from `/account/profile`; the
      profile page keeps a one-line link), team table, and for admins the details form, logo
      uploader, invite form and pending invites.
    - Team: a table from `md` (name, role, live listings, joined), cards below `md`, like
      `InvoiceTable`. Row actions for admins: "Make admin" / "Make member", "Remove".
    - Every destructive action (remove, leave, revoke) confirms inside `<details>`, not a popover.
11. **Public agency page `/agencies/[slug]`:**
    - Shown only while the agency has at least one published listing; otherwise 404 (no empty
      shells, no leaking agencies that never listed).
    - Header: logo (or initials), name, description, website, and the micro note "Details provided
      by the agency." No agency badge: verification stays per person (trust-signal rule).
    - Team: members with at least one published listing in this agency: avatar, display name,
      lister type, their own derived verified badge. Members without published listings are not
      shown.
    - Office contacts: Call, WhatsApp and Email buttons (the `ContactButtons` component) for
      signed-in viewers with a verified email; signed-out viewers get "Sign in to see contact
      details". The listing page rule needs a lister, so the page uses this stricter rule.
    - Listings: the property card grid (`CARD_GRID`), newest first, 24 per page with the existing
      pagination. Ranking tiers are not used on this page (it's one agency's list, not a search),
      so there is no paid-placement ordering to disclose.
    - Metadata: title "<agency> — properties on VerifiedPropertiesKE", description from the
      agency description (155 chars), canonical URL; `noindex` on page 2+.
12. **Listing page:** in `ListerPanel`, the agency name links to `/agencies/<slug>` ("View agency"
    link under the name). Cards are unchanged.
13. **Email templates:** `agencyInviteEmail` (agency name, inviter's display name, link, expiry)
    and `agencyRemovedEmail`. Sent directly from the Server Action through the existing transport;
    a send failure doesn't undo the invite. The admin sees "Invite saved, but the email didn't
    send. Copy the link and share it instead."
14. **Rate limits** (new `POLICIES`): `agencyCreatePerUser` 3/day, `agencyInvitePerUser`
    20/hour, `agencyInviteAcceptPerUser` 10/hour, `agencyManagePerUser` 60/hour (role changes,
    removals, details, revokes), and the logo reuses the avatar limit shape
    (`agencyLogoUploadPerUser` 10/hour).

## Files likely to change

- `src/db/schema.ts` (`agency_invites`, unique `agency_members(user_id)`, checks on agency name,
  description and website lengths); new `drizzle/0013_*.sql` + meta via `npm run db:generate`
- new `src/db/queries/agencies.ts` (create, details, members, join, leave, remove, role change),
  `src/db/queries/agency-invites.ts`, `src/db/queries/public-agencies.ts`
- new `src/lib/agencies/` (slug, join plan and warning computation, invite token hashing), with
  unit tests
- new `src/lib/validation/agency.ts` (create, details, invite, member action schemas)
- `src/db/queries/billing.ts` / `payments.ts` (personal listing plan cancel on join, if no helper
  fits), `src/db/queries/listings.ts` (`lockPool` export), `src/db/queries/agency-contacts.ts`
- `src/lib/storage/keys.ts`, `ingest.ts` (agency logo keys)
- new `src/app/account/agency/page.tsx`, `actions.ts`, `logo-actions.ts`,
  `invites/[token]/page.tsx`
- new `src/components/agency/` (create form with warning, details form, team table, invite form,
  pending invites, logo uploader wrapper, public header and team)
- new `src/app/agencies/[slug]/page.tsx`
- `src/app/account/profile/page.tsx` (agency section → link), `src/app/account/onboarding/page.tsx`
  and `ListerProfileForm` redirect (safe `next`), sign-in page "Create an account" link (`next`)
- `src/components/layout/nav.ts` (Agency link), `src/components/listing/ListerPanel.tsx`,
  `src/db/queries/listing-detail.ts` (agency slug)
- `src/lib/email/templates.ts`, `src/lib/rate-limit.ts`
- `src/app/privacy/page.tsx` (invite emails are stored until accepted, revoked or 90 days after
  expiry; agency pages show team members' public names)
- tests: `agencies.integration.test.ts`, `agency-invites.integration.test.ts`,
  `public-exposure.integration.test.ts` (agency page queries), unit tests for slug, warning,
  token, validation, email templates; `route-guards.test.ts` if it lists account routes
- `src/db/seed/sample-data.ts` (one SAMPLE agency with two sample agents, for dev)
- `e2e/visitor.spec.ts` (listing → agency page)

## Implementation requirements

1. Migration generated with `npm run db:generate`, applied with `npm run db:migrate` to dev and
   to the test branch; production gets it on the next deploy as usual. Before adding the unique
   index on `agency_members(user_id)`, query dev and production for users in more than one agency
   and stop if any exist.
2. Join, leave, remove and role-change logic lives in `src/db/queries/agencies.ts` and
   `src/lib/agencies/`, each a single transaction (`withTransaction`). Server Actions only parse,
   check the session and rate limit, call one function and map typed results to messages.
3. Every action finds the caller's agency on the server (`lister_profiles.agency_id`) and checks
   `agency_members.role` inside the transaction. Member ids in forms are checked to belong to that
   agency. Nothing trusts an agency id from the browser.
4. Invite tokens: `crypto.randomBytes(32)` base64url; only the SHA-256 hex is stored; lookups by
   hash; compare with the stored hash only (no timing-sensitive string compare of raw tokens).
5. The join warning (decision 6) and the join transaction use the same plan function, so what
   the user is told is what happens. If the numbers changed between page load and submit (for
   example another agent took the last slot), the transaction still applies the rules and the
   success message states the actual outcome ("2 listings were paused").
6. Server components by default; client components only for the logo uploader and copy-link
   button. Every request-time read sits inside `<Suspense>` (Cache Components).
7. UI uses the compact system: six type sizes only, `h-control` buttons and inputs, panels
   `rounded-lg border-line p-5/p-6`, property cards `rounded-xl`, 1px borders, no shadows, no
   `rounded-2xl`. Phones: no horizontal scroll at 320px; the team table becomes cards below `md`.
8. Forms follow the existing pattern: Zod v4, `aria-invalid`, described errors, values kept after
   a failed submit, `FormAlert` for form-level errors.

## Security requirements

- Only an admin of the caller's own agency can change it, invite, revoke, change roles, remove or
  upload a logo. Integration tests prove a plain member, an admin of another agency and a non-member
  are refused for each.
- Accepting checks the invite email against the signed-in user's verified email inside the
  transaction; a forwarded link can't be used by someone else. Used, revoked and expired tokens
  are refused.
- Roles: `agency_admin` is only granted by these transactions (create, admin invite, promotion)
  and revoked on demotion, leave and removal. No route accepts a role from the browser except the
  admin|member choice on an invite or role change, validated by an allowlist and the caller's
  admin check.
- The public agency queries return only public columns (name, slug, description, website, logo
  key, member display names, avatars, lister types, verified flag, card columns). No emails, phone
  numbers, user ids or invite data. The exposure test covers them. Office contacts are read only
  for signed-in viewers with a verified email.
- Billing: the personal plan cancellation is audited, its open invoices are voided, and no money
  moves. Entitlement for the agency is still computed only from stored rows.
- Logs carry ids and error names only: no emails (masked if ever needed), tokens or phone numbers.
- Website URLs: https only, rendered with `rel="nofollow ugc noopener"` and `target="_blank"`.

## Acceptance criteria

- A lister creates an agency, sees the warning with their real numbers, and lands on
  `/account/agency` as its admin; their listings are now agency listings.
- An admin invites an email; the email (or the dev console) shows the link; the invitee signs up
  with that email, verifies, sets up a lister profile if needed, returns to the invite and accepts
  after seeing the warning. Their own listing plan is cancelled, their listings move in, and any
  over the agency limit are paused.
- The wrong account, an expired invite, a revoked invite and a used invite all show the right
  message and change nothing.
- Admins can rename the agency, change the description, website and logo, edit office contacts,
  promote and demote (never the last admin), remove a member (who gets the email and finds their
  listings paused), and revoke an invite.
- A member can leave; their listings leave the agency and are paused; they can buy their own plan
  and un-pause.
- `/agencies/<slug>` shows the agency, its team (only members with published listings, each with
  their own badge) and its published listings, and 404s for an agency without any. Office contact
  buttons appear only when signed in.
- The listing page links to the agency page.
- axe: 0 violations on `/account/agency`, the invite page and `/agencies/<slug>`.
- `typecheck`, `lint`, `test`, `test:integration`, `build` pass; the e2e visitor spec passes.

## Checks to run

- `npm run db:generate`, `npm run db:migrate` (dev, then the test branch)
- `npm run typecheck`, `npm run lint`, `npm test`
- `npm run test:integration`
- `npm run build`
- `npm run e2e -- e2e/visitor.spec.ts e2e/a11y.spec.ts` (after an e2e branch reset, with your OK)

## Manual test steps (after implementation)

1. `npm run dev`. Sign in as a lister with a listing plan and a couple of published listings.
   Account → **Agency** → fill "Create an agency". Read the warning (your listing count and plan),
   then create. Your listings are now under the agency and paused, because the agency has no plan
   yet.
2. Account → Subscription & billing: buy the agency plan (sandbox). The paused listings come back
   up to the limit.
3. On Agency: upload a logo, add a description and website, set the office phone and WhatsApp.
4. Invite a second email you control. Watch the dev server terminal for the "Development email"
   block and copy the link (or use "Copy invite link").
5. In a private window, open the link → sign in page → "Create an account" with that email →
   verify (link in the terminal) → set up the listing profile → you return to the invite → read
   the warning → **Join**.
6. Try the same link again (used), and open it signed in as a third account (wrong email).
7. As the admin: make the new agent an admin, then a member again; try to demote yourself while
   you're the only admin (refused). Remove the agent: they get the email (terminal) and their
   listings show as paused in their My listings.
8. Open one of the agency's listings signed out: the panel shows "View agency". Open the agency
   page: logo, description, team, listings; the contact buttons ask you to sign in. Sign in and
   check the office buttons appear.
9. Open `/agencies/<slug>` for an agency with no published listings → 404.
10. On your phone: `/account/agency` (team cards, no sideways scroll) and the agency page.
