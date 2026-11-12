# S24: Agency directory and invite hardening

## Goal

1. **Agencies page** at `/agencies`: every agency that has at least one published listing, with
   its logo, name and number of published listings, each linking to its agency page
   (`/agencies/[slug]`, built in S23).
2. **"Agencies" in the main navigation** (desktop header and mobile menu), after "Explore".
3. **Invite hardening** (owner request after the S23 security review): the invite queries also
   require a verified email themselves, not only the pages and actions that call them.

**Out of scope:** search, filters or sorting choices on the directory; agency badges or
"verified agency" labels; a directory entry in the footer (can follow).

## References read

- `AGENTS.md` §1 design rules (compact system, six type sizes, `rounded-sm` cards, `p-3`,
  `PageContainer`, 44px targets), §6 "Ranking … paid placement is always disclosed" and "Trust
  signals", §8, §9
- `docs/implementation-plan-v2.md` §13 Phase 5 "Agency pages for verified agencies" (pages
  brought forward in S23), §12 "no dead links in header or footer"
- `prompts/s23-agencies.md` decision 11 (an agency page exists only while it has a published
  listing; no agency-level badge)
- Design folder: no directory screen; cards follow the existing small-card style (team cards on
  the agency page, `rounded-sm border-line bg-white p-3`)

## Existing code inspected

- `src/components/layout/nav.ts` `MAIN_NAV` (used by `SiteHeader.tsx` and `MobileMenu.tsx`),
  `src/app/links.test.ts` (every nav link must resolve to a page)
- `src/db/queries/public-agencies.ts` (`getPublicAgency` and the published-listing rule),
  `src/app/agencies/[slug]/page.tsx`, `src/components/search/Pagination.tsx` (`hrefFor`)
- `src/db/queries/agency-invites.ts` `lockInviteFor`, `acceptInvite`, `declineInvite`,
  `openInvitesFor`; callers in `src/app/account/agency/actions.ts`, `page.tsx` and
  `invites/[token]/page.tsx` (all behind `requireUser`, which already demands a verified email)
- `src/db/queries/public-exposure.integration.test.ts`

## Decisions and assumptions

1. **Which agencies:** only those with at least one published listing, the same rule as the
   agency page, so every card links to a page that exists and empty shells never appear.
2. **Order:** most published listings first, then name A–Z. This is a plain count of live
   listings, not paid placement, so there is nothing to disclose; verification and plans play no
   part. Stated in a micro line under the heading ("Sorted by number of listings").
3. **Count:** published listings only (the same listings the agency page shows), shown as
   "12 listings" / "1 listing".
4. **Card:** logo (or initials) `Avatar size="md"`, agency name (`text-small font-semibold`),
   count (`text-micro text-slate-600`), whole card is one link with a visible focus ring. No
   badge, no contacts, no description (keeps the page light; details are one tap away).
5. **Layout:** `PageContainer`; H1 "Agencies" (`text-display-sm`) with a `text-body` intro;
   grid of cards 1 column on phones, 2 from `sm`, 3 from `md`, 4 from `lg`; 48 per page with the
   existing `Pagination` (`hrefFor`). Empty state ("No agencies yet") when none qualify.
6. **Navigation:** `MAIN_NAV` becomes Home, Explore, Agencies, How it works, Pricing. The header
   already fits five items at the 10px/`2xl:text-small` sizes; checked at 768px, 1024px and
   1440px. The mobile menu lists it automatically.
7. **SEO:** title "Property agencies in Kenya", a description, canonical `/agencies`; page 2+ is
   `noindex`.
8. **Invite hardening:** `acceptInvite`, `declineInvite` and `lockInviteFor` take
   `{ id, email, emailVerified }` and refuse with `wrong_email` when `emailVerified` is false;
   `openInvitesFor` takes the user and returns `[]` for an unverified email. Callers pass
   `user.emailVerified` (always true behind `requireUser` today; this guards future callers).

## Files likely to change

- `src/db/queries/public-agencies.ts` (new `listAgencyDirectory(db, page)`)
- new `src/app/agencies/page.tsx`; new `src/components/agency/AgencyDirectoryCard.tsx`
- `src/components/layout/nav.ts`
- `src/db/queries/agency-invites.ts`, `src/app/account/agency/actions.ts`,
  `src/app/account/agency/page.tsx`
- tests: `src/db/queries/agencies.integration.test.ts` (directory order and counts, unverified
  refusals), `src/db/queries/public-exposure.integration.test.ts` (directory returns public
  fields only), `e2e/visitor.spec.ts` (nav link → directory loads)

## Implementation requirements

1. One query: agencies joined to a grouped count of their `published` listings, `having count > 0`,
   ordered `count desc, name asc, id`, `limit 48 offset …`, plus a total count for pagination.
   Returns only `name`, `slug`, `logoKey`, `listingCount`.
2. The page is a server component; the data read sits inside `<Suspense>` (Cache Components)
   with a card-grid skeleton; `await connection()` before the database read, as other public
   readers do.
3. Page numbers are parsed defensively (integer 1–9999, else 1); a page past the end shows the
   last page.
4. Compact system only: six type sizes, `rounded-sm` cards with `border-line`, 44px tap targets
   (the whole card), no shadows, no `rounded-2xl`.

## Security requirements

- The directory returns only public fields (no ids, contacts, emails, member data); the exposure
  test covers it.
- Counts come from `published` rows only, so drafts, paused and hidden listings never leak
  through a number.
- Invite queries refuse unverified users themselves (decision 8); integration tests prove an
  unverified user with the right email can neither accept, decline nor list the invite.

## Acceptance criteria

- "Agencies" appears in the header and the mobile menu and opens `/agencies`.
- `/agencies` lists only agencies with published listings, most listings first, with correct
  counts, and each card opens that agency's page.
- An agency whose only listing is paused or withdrawn disappears from the directory.
- With no qualifying agencies the empty state shows.
- No horizontal scroll at 320px and 390px; the header nav doesn't wrap at 768px.
- Unverified users are refused by the invite queries.
- `typecheck`, `lint`, `test`, `test:integration`, `build` pass.

## Checks to run

- `npm run typecheck`, `npm run lint`, `npm test`
- `npm run test:integration` (agencies and exposure suites at least)
- `npm run build`
- Edge walkthrough of `/agencies` and the header at 390px, 768px and 1440px

## Manual test steps (after implementation)

1. `npm run dev`; open the home page. "Agencies" is in the header between Explore and How it
   works; on a phone it is in the menu.
2. Open Agencies. With no agency that has a published listing, "No agencies yet" shows.
3. As an agency admin with the agency plan, publish a listing. Reload `/agencies`: the agency
   appears with "1 listing". Click it to open its page.
4. Pause or withdraw that listing: the agency leaves the directory.
5. On your phone, open `/agencies` and check the cards stack and nothing scrolls sideways.
