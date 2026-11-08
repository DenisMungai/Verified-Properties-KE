# S15 — In-app messaging

Fourth slice of Phase 2 (plan v2.0 §10 "In-app messaging"). It follows S14 (home featured
sections and the help page). Notifications (email alerts for new messages) are S16; the Phase 2
exit is S17.

## Goal

Buyers and listers talk inside the app instead of only through the S8 contact form:

1. **Conversations.** Each conversation belongs to one listing, one buyer and one lister. It is
   created on the buyer's first message about that listing and reused after that. The S8 contact
   form ("Request a viewing") becomes that first message.
2. **Inbox and thread.** `/account/messages` lists every conversation the user is in, on either
   side, with unread counts. `/account/messages/[id]` shows the thread and a reply box.
3. **Unread badges.** The header account button, the mobile menu and the "Messages" nav item show
   the unread count. Open threads and the badge poll every 15 seconds while the tab is visible.
4. **Safety.**
   - Only participants read or send, and the server checks this on every send.
   - Message text is plain text only.
   - Rate limits, duplicate-send guard and link handling.
   - Either side can report a message or block the other person.
5. **Moderation.** Platform admins see reported messages in `/admin/reports`. They open the
   reported conversation (every view is logged), then dismiss the report, remove the message, or
   remove it and close the conversation.

Phase 2 exit criteria covered here: "A buyer and an agent exchange messages" and "cross-user
access to conversations … is shown to be blocked" (integration tests).

Out of scope:

- email or SMS alerts for new messages (S16)
- attachments, images or typing indicators
- read receipts shown to the sender
- real-time push (WebSockets or SSE); polling is the plan's choice
- messaging between two listers outside a listing
- agency members sharing a conversation (see decision 2)

## References read

- `AGENTS.md`
- `docs/implementation-plan-v2.md`:
  - §10 "In-app messaging" (conversations tied to listing, buyer and lister, created or reused on
    first message; inbox with unread counts on both sides; sender must be a participant; plain
    text; rate limits, spam-link handling, report and block, moderator access; 10–15 s polling)
  - §10 exit criteria; §12 "Buyer A cannot read Buyer B's messages", rate limits on messaging
  - §6 / §16 contact rule (verified phones public, others after a signed-in inquiry)
  - §3 rate-limit row (inquiries, messages)
- `prompts/s8-detail-engagement.md` decisions 1, 2, 11 (contact rule, inquiry form, lister inbox)
- `prompts/s13-verification-lifecycle.md` (lister stats card links to inquiries)
- `prompts/ui-compact-design-system.md`, `prompts/ui-mobile-optimization.md`
- Design folder: there is **no messaging screen**. The inbox follows `01 — Lister Dashboard`
  (account shell, sidebar, list rows on white with `border-line`). The thread borrows the
  `03 — Property Detail` lister panel (avatar, name, badge) for its header.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` (with Cache
  Components, `GET` handlers run at request time once they read the request or the database)
  and `07-mutating-data.md` (Server Functions are dispatched one at a time, so they are not used
  for polling)
- Reference implementation `../propertyhub-phase1-final`: no messaging. Nothing to adapt.

## Existing code inspected

- `src/db/schema.ts`:
  - `conversations` (property, buyer, lister, `last_message_at`; unique triple; distinct
    participants; buyer and lister recency indexes)
  - `messages` (conversation, sender, body 1–5000, `read_at`, `reported_at`; conversation +
    created index)
  - `inquiries`, `listing_reports`, `listing_moderation_log` (append-only trigger in
    `drizzle/0001_core_schema.sql`), `reportStatus` enum
  - Both chat tables exist since S2 and are empty.
- `src/db/queries/inquiries.ts`:
  - `createInquiry`: an advisory lock per sender and listing; published only; not your own
    (`manageableBy`); 3 per listing per 24 h; an exact repeat is refused
  - `hasInquired`, `getListerContact`, `listReceived`, `unreadCount`, `markRead`
- `src/app/properties/actions.ts`: `sendInquiryAction`, which needs a verified email, runs the
  `inquiryPerUser` limit, then `withTransaction(createInquiry)` and `refresh()`
- `src/components/listing/ListerPanel.tsx` and `InquiryForm.tsx`; the `Viewer` union
  (signed_out / own / buyer)
- `src/lib/listings/contact.ts`: the contact rule, unchanged by S15
- `src/app/account/inquiries/page.tsx` and `actions.ts`: the S8 lister inbox
- `src/components/layout/nav.ts` (`accountLinks`), `AccountNav`, `AccountMenu`, `MobileMenu`,
  `SiteHeader` (session read inside `<Suspense>`)
- `src/app/admin/reports/page.tsx`, `src/db/queries/reports.ts`, `moderation.ts`
  (`takeDownForReport`), `components/admin/DecisionForms.tsx`
- `src/lib/rate-limit.ts` (`POLICIES`, `checkRateLimits`, Upstash in production, memory in dev)
- `src/db/queries/lister-stats.ts` and `components/account/ListerStats.tsx` (the "View
  enquiries" link)
- `src/lib/validation/engagement.ts` (`inquirySchema`, `decisionReasonSchema`, report reasons)

## Decisions and assumptions

1. **The contact form starts the conversation.** `sendInquiryAction` keeps writing the
   `inquiries` row, because the contact rule, lister stats and the buyer's phone/email depend on
   it. In the same transaction it creates or reuses the conversation and adds the inquiry text as
   a message.
   - The success message becomes "Message sent." plus a link: "Open the conversation".
   - The S8 limits (3 per listing per day, exact repeat refused) still apply to the form.
2. **Participants are exactly `buyer_user_id` and `lister_user_id`.** `lister_user_id` is the
   listing's `owner_user_id` at creation.
   - Agency admins who can manage the listing don't see the conversation. They saw S8 inquiries
     through `manageableBy`, but chat is person to person.
   - If agencies need a shared inbox later, that's a new slice.
   - A user can be a buyer in some conversations and a lister in others; one inbox shows both.
3. **Only buyers start conversations**, and only from a published listing that isn't theirs
   (the same `manageableBy` check as inquiries). Listers reply; they never cold-message.
4. **The panel after the first message.** When the signed-in viewer already has a conversation
   about this listing, the lister panel replaces the form with a "Message the lister" button that
   opens the thread. The contact details the inquiry unlocked stay visible.
5. **`/account/inquiries` is retired.**
   - The page redirects to `/account/messages` (a temporary redirect in the page, so old
     bookmarks work).
   - Its actions file and the `listReceived` / `markRead` / `unreadCount` inquiry queries are
     deleted once nothing uses them.
   - The "Inquiries" nav item becomes "Messages" for everyone, buyers included.
   - The lister stats card link becomes "View messages" → `/account/messages`. Its count still
     comes from `inquiries`, the number of buyers who used the form.
6. **Backfill.** Migration `0009_messaging` turns every existing inquiry into a conversation and
   message:
   - the conversation is upserted on (property, sender, recipient)
   - `created_at` and `read_at` are kept
   - `last_message_at` is the latest inquiry time
   - after the backfill, nothing is lost by retiring the inquiries page

   This runs on dev, test and production. Production has only the owner's own data.
7. **The lister sees the buyer's contact details in the thread.** The thread header shows, for
   the lister only, the phone and email from the buyer's most recent inquiry about this listing
   (none if there is none).
   - Buyers see the lister's details only through the existing contact rule (verified phone, or
     everything after an inquiry). The thread uses `contactVisibility` and `visibleContact`
     unchanged.
8. **Message rules** (shared Zod schema `messageSchema`):
   - Text is trimmed and between 1 and 2000 characters (the DB allows 5000).
   - At most **2 links** per message. A link is `http(s)://…`, `www.…`, or a bare domain with a
     common TLD. A message with more links is refused: "Messages can include at most 2 links."
   - Links are **never clickable**. They render as plain text, like the rest of the body.
   - When a message from the *other* person contains a link, a micro warning shows under it:
     "Be careful with links. Never send a deposit or your M-Pesa PIN before viewing."
   - **Duplicate guard:** sending the exact text of your own last message in that conversation
     within 60 seconds is refused as a double send. The action returns ok without a second row.
9. **Sending.** `sendMessage(tx, userId, conversationId, body)` runs inside a transaction with an
   advisory lock per conversation. It:
   - checks that the user is a participant (otherwise "not found", so it never confirms the
     conversation exists)
   - checks the conversation isn't closed
   - checks neither participant has blocked the other
   - checks the duplicate guard
   - inserts the message and sets `last_message_at`

   It returns a typed union: `ok`, or `not_found | closed | blocked | duplicate`. The listing's
   status doesn't matter: a sold or paused listing's conversation stays open.
10. **Read state.** Opening a thread marks the other person's unread messages in it read, on the
    server, in the page's data load. There are no "seen" ticks for the sender.
    - Unread count = messages in the user's conversations, sent by the other person, `read_at`
      null, not removed.
    - The inbox shows a per-conversation count.
11. **Blocking is per person pair, not per conversation.**
    - New table `user_blocks (blocker_user_id, blocked_user_id, created_at)`, primary key on the
      pair.
    - A block stops sending in both directions in every conversation between the two. It also
      stops the blocked buyer from starting a new one with that lister: the inquiry form is
      refused with "You can't message this lister."
    - The blocker sees "You blocked this person" with an Unblock button. The blocked person sees
      "You can't reply to this conversation", which doesn't say who blocked whom.
    - Past messages stay readable for both.
12. **Reporting a message.**
    - Only the recipient can report a message.
    - New table `message_reports`, with columns:
      - `id`, `message_id`, `conversation_id`
      - `reporter_user_id`, `reason` (from the existing `REPORT_REASONS` minus listing-only ones:
        `scam`, `offensive`, `spam`, `other`)
      - `details` ≤ 2000
      - `status reportStatus`, `resolved_by`, `resolved_at`, `created_at`
    - There is one open report per reporter and message (partial unique index). A repeat report
      is answered "You've already reported this message."
    - The first report also sets `messages.reported_at`.
    - The report form offers "Also block this person" (checked by default).
13. **Moderator access** (platform_admin only, like listing reports):
    - `/admin/reports` gains a second section, "Reported messages", listing open message reports:
      reason, reporter, time, and a 140-character excerpt of the reported message only.
    - "Open conversation" → `/admin/reports/messages/[reportId]` shows the full thread, marks the
      reported message and names both participants. Opening it writes a `view_conversation` row
      to the log.
    - The admin's choices (reason 10–500 characters, from `decisionReasonSchema`, needed for the
      second and third):
      - **Dismiss report**
      - **Remove message:** the body stays for evidence; both participants see "This message was
        removed by a moderator."
      - **Remove message and close conversation:** nobody can send any more; both see "This
        conversation was closed by VerifiedPropertiesKE."
    - Resolving one report resolves every open report on the same message.
    - New append-only table `message_moderation_log` (trigger like `listing_moderation_log`):
      `actor_user_id`, `action` (`view_conversation | dismiss_report | remove_message |
      close_conversation`), `conversation_id`, `message_id`, `report_id`, `reason`, `created_at`.
14. **Polling with a GET route handler, not a Server Action** (actions are dispatched one at a
    time):
    - `GET /api/messages/status?conversation=<uuid>` returns
      `{ unread: number, lastMessageAt?: string }`. `lastMessageAt` only comes back when the user
      is a participant in that conversation. The route needs a session (401 JSON otherwise) and
      sends `Cache-Control: no-store`.
    - Client `useMessagePolling` hook:
      - runs every **15 s** while `document.visibilityState === "visible"`, and checks right away
        when the tab becomes visible again
      - stops after 3 straight errors until the next visibility change
    - The badge updates its count from the response.
    - The open thread calls `router.refresh()` only when `lastMessageAt` changed, so messages
      still render on the server. The reply box keeps its text because it is uncontrolled, and a
      refresh keeps client state.
    - The inbox page also refreshes when the unread total changes.
15. **Rate limits** (new `POLICIES`):
    - `messagePerUser` 60 per hour
    - `messageReportPerUser` 10 per hour
    - `blockPerUser` 20 per hour
    - `messagePollPerUser` 600 per hour; when it's exceeded the route answers 429 and the client
      backs off to its next tick

    The inquiry form keeps `inquiryPerUser`.
16. **Sessions.** Every messaging page and action needs a signed-in user with a verified email,
    as S8 engagement does. Buyers need no lister profile, so `requireUser`, not `requireLister`.
    The admin page uses `requireRole(["platform_admin"])`.
17. **Logs** contain ids and outcomes only, never message text, names or contact details.
18. **Retention.** Conversations are kept while both accounts exist. A retention policy is
    S17/Phase 4 work and is noted in the exit report.

## Files likely to change

Schema and migration:

- `src/db/schema.ts`:
  - `messages`: add `removed_at`, `removed_by`
  - `conversations`: add `closed_at`, `closed_by`
  - new `user_blocks`, `message_reports`, `message_moderation_log`
  - indexes: `message_reports(status, created_at desc)`, partial unique open report per reporter
    and message, `user_blocks(blocked_user_id)`
  - a partial index for unread: `messages(conversation_id) where read_at is null`
- `drizzle/0009_messaging.sql` (generated, plus hand-added append-only trigger and the inquiry
  backfill)

Queries and logic:

- `src/db/queries/messaging.ts` (new):
  - `startOrReuseConversation`, `sendMessage`
  - `listConversations`, `getThread` (participant-scoped), `markThreadRead`
  - `unreadTotal`, `conversationStatus`
  - `blockUser`, `unblockUser`, `isBlockedBetween`
  - `conversationForListing`
- `src/db/queries/message-moderation.ts` (new):
  - `reportMessage`, `listOpenMessageReports`
  - `getReportedThread` (logs the view), `dismissMessageReport`, `removeMessage`,
    `closeConversation`
- `src/db/queries/inquiries.ts`:
  - `createInquiry` also calls `startOrReuseConversation` and inserts the message
  - refuses when blocked
  - drops the retired inbox functions
- `src/lib/validation/messaging.ts` (new): `messageSchema`, `messageReportSchema`,
  `countLinks`, `hasLink`, `MESSAGE_MAX`, `MAX_LINKS`
- `src/lib/rate-limit.ts` (new policies)

Routes and pages:

- `src/app/account/messages/page.tsx`, `[id]/page.tsx`, `actions.ts` (send, block, unblock,
  report)
- `src/app/api/messages/status/route.ts` (GET)
- `src/app/account/inquiries/page.tsx` (redirect only); delete `inquiries/actions.ts`
- `src/app/properties/actions.ts` (inquiry result maps `blocked`; success links the thread)
- `src/app/properties/[slug]/page.tsx` (passes the existing conversation id to the panel)
- `src/app/admin/reports/page.tsx` (second section), `admin/reports/messages/[id]/page.tsx`,
  `admin/actions.ts` or a new `admin/reports/actions.ts`

Components:

- `src/components/messaging/`:
  - `ConversationList`, `ThreadHeader`, `MessageBubble`
  - `ReplyForm` (client), `ReportMessageForm` (client), `BlockControls`
  - `UnreadBadge` (client), `useMessagePolling` (client)
- `src/components/listing/ListerPanel.tsx`, `InquiryForm.tsx`
- `src/components/layout/nav.ts`, `AccountMenu.tsx`, `MobileMenu.tsx`, `SiteHeader.tsx`,
  `components/account/AccountNav.tsx` (badge)
- `src/components/account/ListerStats.tsx` (link)
- `src/components/admin/DecisionForms.tsx` (message decisions)

Seed and tests:

- `src/db/seed/seed.ts`: two SAMPLE conversations
- Tests:
  - `src/lib/validation/messaging.test.ts`
  - `src/db/queries/messaging.integration.test.ts`
  - `message-moderation.integration.test.ts`
  - update `engagement.integration.test.ts`

## Implementation requirements

### Data layer

- Every read and write goes through the participant check. It is built into the `where` clause
  (`buyer_user_id = $me or lister_user_id = $me`), never as a fetch by id followed by a JS check.
  An id that isn't yours behaves exactly like one that doesn't exist.
- `startOrReuseConversation(tx, buyerId, propertyId)`:
  - inserts `on conflict (property_id, buyer_user_id, lister_user_id) do nothing`, then selects
  - `lister_user_id` comes from the property row, never from input
- `listConversations(db, userId)` returns, per conversation:
  - id, the user's role in it (`buyer` or `lister`)
  - the other person's display name and avatar key (buyer: the lister profile's display name,
    falling back to the user name; lister: the buyer's user name)
  - listing title, slug, status and cover key
  - last message excerpt (120 characters; "Message removed" when removed) and its sender (to
    prefix "You: ")
  - `last_message_at`, unread count, closed flag

  Ordered by `last_message_at desc`, limit 100. One query with lateral joins, or two queries;
  never one query per row.
- `getThread(db, userId, conversationId)` returns the conversation header data and up to the
  latest 200 messages, oldest first. Removed messages come with `body: null`.
- `markThreadRead` updates only messages sent by the other participant in a conversation the
  user is in.
- Inquiry backfill SQL in `0009`:
  1. insert conversations from `inquiries` grouped by (property, sender, recipient), `on conflict
     do nothing`
  2. insert messages from each inquiry with its `created_at` and `read_at`
  3. update `last_message_at` to the max

  Guarded so that running it twice can't duplicate messages, for example `where not exists` on
  (conversation, sender, created_at, body).

### Actions (`src/app/account/messages/actions.ts`)

Each action:

1. reads the session (verified email)
2. validates ids with `z.uuid()` and input with the shared schema
3. applies its rate limit
4. calls one query
5. maps the typed result to a user message
6. calls `refresh()` on success

Results are `ActionState`.

- `sendMessageAction`: on `duplicate` it returns ok silently; on `blocked` / `closed` /
  `not_found` it returns the message for that case.
- `blockUserAction` / `unblockUserAction`: take the conversation id and derive the other
  participant on the server. They never take a user id from the form.
- `reportMessageAction`: refuses unless the message was sent by the other participant in a
  conversation the reporter is in. With the block box checked, it also blocks in the same
  transaction.

### Status route (`src/app/api/messages/status/route.ts`)

- Exports `GET` only. It reads the session through `src/lib/session.ts`.
- Validates `conversation` with `z.uuid()` when present (an invalid value is ignored).
- Responses: JSON, `Cache-Control: no-store`, 401 without a session, 429 over the limit. Errors
  return 500 `{ error: "unavailable" }` with no details.

### Admin

- Message decisions run in a transaction:
  1. lock the report
  2. re-check that it is open
  3. apply the action
  4. resolve every open report on that message
  5. write `message_moderation_log`
- The page and each action check `platform_admin`. Notices follow the existing `?notice=` pattern.

## UI

All tokens come from `tailwind.config.ts` and the compact system.

**Inbox** `/account/messages` (account shell, `PageHeading` "Messages", description
"Conversations with buyers, tenants and listers.")

- The list is a `ul` of rows with `border border-line rounded-sm bg-white`, gap 2.
- Each row is a full-width link, `p-3`, min-height 64px, with:
  - The listing cover thumbnail, 56×56 px, `rounded-sm`, `object-cover`. A neutral `bg-mint-50`
    tile with a Home icon when there is none.
  - The other person's name (`text-small font-semibold text-ink`), and the listing title on its
    own line (`text-micro text-slate-600`, truncate).
  - The excerpt (`text-small text-slate-600`, one line, truncate; prefixed "You: " for your own).
  - On the right: time (`text-micro text-slate-600`; today shows the time, otherwise the date, in
    Nairobi) and an unread pill (`rounded-full bg-emerald-600 text-white text-micro px-2`).
- An unread row's name and excerpt use `text-ink font-semibold`.
- A closed conversation shows a micro "Closed" badge.
- Role chip (`Badge` neutral, micro): "Your listing" when the user is the lister there, so
  someone on both sides can tell them apart.
- Empty state (`EmptyState`, `MessageSquare` icon):
  - title "No messages yet"
  - description: buyers get "When you contact a lister about a property, the conversation
    appears here."; listers get "When buyers message you about a listing, the conversation
    appears here."
  - actions: buyers "Explore properties", listers "Go to My listings"
- A `role="status"` line: "N conversations · M unread".

**Thread** `/account/messages/[id]`

- Back link "← Messages" (`text-small`, `min-h-control`).
- **Header panel** (`rounded-lg border border-line bg-white p-5`):
  - `Avatar` md, the other person's name (`text-title`), and the `VerifiedBadge` when the lister
    is verified (derived, as on the detail page)
  - "About [listing title]" linking to the listing when published
  - Lister-side: the buyer's phone (`tel:`) and email (`mailto:`) from decision 7
  - Buyer-side: the lister contact as the contact rule allows
  - Header actions on the right: a "More" disclosure (`details`/`summary`, not the Popover API,
    because the user's phone lacks it) holding "Block"/"Unblock". Report sits on each message.
- **Messages:**
  - an `ol` with `aria-label="Messages"`, gap 2, and day separators (`text-micro text-slate-600`,
    centred: "Today", "Yesterday", or the date)
  - Own bubbles align right, `bg-mint-50 text-ink`. The other person's bubbles align left, `bg-white
    border border-line`.
  - Bubbles are `rounded-lg px-3 py-2 max-w-[85%] sm:max-w-[70%]`, body `text-body
    whitespace-pre-line break-words`, time underneath in `text-micro text-slate-600`.
  - A removed message is an italic `text-small text-slate-600` "This message was removed by a
    moderator."
  - The link warning (decision 8) sits under the other person's linked message, in `text-micro
    text-warning-text`.
  - "Report" is a `text-micro` quiet button under the other person's messages. It opens an inline
    `details` form with:
    - a reason select
    - a details textarea (optional)
    - an "Also block this person" checkbox
    - a submit button
- On load the page scrolls to the latest message, using an anchor `#latest` on the last item and
  a small client effect; no layout jump.
- **Reply box:**
  - a `Textarea` with 3 rows, `maxLength` 2000, label "Reply" (visually hidden), and a "Send"
    button `h-control`
  - below `sm` it sits in a fixed bottom bar with `data-mobile-bar`, so the page pads beneath it
  - the textarea is 16px on phones, per globals
  - Enter adds a newline; the button sends
  - after a successful send the form clears (keyed remount, as in InquiryForm)
- Instead of the reply box:
  - blocked: a `rounded-md bg-mint-50 p-3 text-small` note with an Unblock button for the
    blocker, or "You can't reply to this conversation." for the other person
  - closed: "This conversation was closed by VerifiedPropertiesKE."
- Polling (decision 14) runs on this page and the inbox.

**Badge:**

- `UnreadBadge` is a client component that receives the server-rendered initial count and
  polls.
- It is shown:
  - on the desktop account button: a dot plus count, `bg-emerald-600 text-white text-micro
    rounded-full min-w-5 h-5`
  - on the mobile menu button: a dot only
  - next to "Messages" in `AccountMenu`, `MobileMenu` and `AccountNav`
- Its `aria-label` reads "N unread messages".
- It is hidden at 0.
- The initial count is read in the header's existing Suspense loaders.

**Listing panel:** decision 4. The button reads "Message the lister" (`buttonClasses size lg
w-full`). Own-listing copy links "Messages" instead of "Inquiries".

**Admin** "Reported messages":

- same layout as the listing report items (`rounded-lg border border-line bg-white p-5`)
- the thread page reuses the bubbles in read-only mode, with the reported message ringed
  (`ring-2 ring-warning`) and the decision forms below

Mobile (< 640px):

- inbox rows keep the 56px thumbnail
- the thread's header panel uses `p-4`, and its contact links wrap
- no horizontal scroll at 390px
- touch targets: reply, send, block and report are 44px; "Report" under a bubble may be 32px
  (`control-sm`) with a 44px hit area

## Security requirements

- Participant scoping is in SQL on every query; ids from the client are only lookup keys.
- The lister participant comes from the property row and the block target from the
  conversation, never from form fields.
- Message bodies are stored trimmed and rendered as React text: no `dangerouslySetInnerHTML`,
  no autolinking, no markdown.
- Admin thread access only through an open or recent report, `platform_admin` only, with every
  view logged in the append-only `message_moderation_log`.
- The status route returns counts and a timestamp only, never message text.
- Rate limits are in place for send, report, block and poll. Production refuses to run without
  Upstash (existing behaviour).
- No message text, names, phones or emails in logs.
- Migration `0009` is applied to dev, the test branch **and production before pushing**
  (memory: push = live deploy), using `PROD_DATABASE_URL_UNPOOLED` via `node --env-file`, never
  printed, after checking the host label `ep-summer-morning-b9otl4v9`.

## Acceptance criteria

1. A signed-in buyer sends "Request a viewing" on a listing:
   - an inquiry row is written, as before
   - a conversation and first message appear
   - the success notice links to the thread
   - reloading the listing shows "Message the lister" instead of the form
2. The lister sees the conversation in `/account/messages` with an unread pill and a header
   badge, replies, and the buyer's badge updates within about 15 s without a reload. The buyer's
   open thread shows the reply within about 15 s.
3. A third user who opens `/account/messages/<their id>` gets the not-found page. Posting
   `sendMessageAction` with that id is refused as `not_found` and writes nothing.
   `/api/messages/status?conversation=<their id>` returns no `lastMessageAt`.
4. A message with 3 links is refused. A 2-link message is shown as plain text with no anchors,
   and the recipient sees the warning. A double-click send creates one message.
5. Blocking:
   - after a block neither side can send
   - the blocked buyer's new inquiry to that lister is refused
   - unblock restores both
6. Reporting a message (with block):
   - it appears in `/admin/reports` → "Reported messages"
   - opening it logs `view_conversation`
   - "Remove message" hides the text for both participants
   - "Remove and close" stops all sending
   - the log rows can't be updated or deleted
7. A buyer with no lister profile can use Messages. "Inquiries" is gone from every nav, and
   `/account/inquiries` redirects to `/account/messages`.
8. Backfilled S8 inquiries on dev show as conversations with their original times and read
   state.
9. Rate limits trip as configured (unit-tested via the memory limiter).
10. 390px: inbox, thread and reply bar fit with no horizontal scroll, and the reply bar doesn't
    cover the last message.
11. Typecheck, lint, unit, integration and build all pass.

## Checks to run

- `npm run db:generate`; review `drizzle/0009_messaging.sql` and add the trigger and backfill
- `npm run db:migrate` (dev); apply to the test branch; apply to production before pushing
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration`, covering:
  - participant scoping for every read and write
  - cross-user blocking
  - blocks, duplicate guard, report uniqueness
  - moderation actions and the log trigger
  - the inquiry-to-conversation path and the backfill idempotence

  The leftover test-branch users `p_member` / `s8m_admin` are cleaned first if they still break
  suites.
- `npm run build`
- Browser check in Edge via playwright-core: two signed-in contexts (buyer and lister) at 1440px
  and 390px, polling confirmed

## Manual test steps (after implementation)

1. `npm run dev`. Sign in as a buyer (any dev buyer, or sign up and verify via the link in the
   dev terminal).
2. Open a published sample listing → fill "Request a viewing" → send. Click "Open the
   conversation".
3. In a second browser profile (or InPrivate), sign in as that listing's lister. Check the header
   badge, then open Messages → the conversation and reply.
4. In the buyer window, keep the thread open. The reply appears within about 15 s, and the badge
   clears after viewing.
5. As the buyer, send a message with three links (refused), then with one link. As the lister,
   see the link as plain text with the warning.
6. As the lister, use More → Block. Try to send from both sides (refused). Unblock.
7. As the lister, report the buyer's message (reason "Spam", block ticked).
8. Sign in as the platform admin → Admin → Reported messages → Open conversation → "Remove
   message" with a reason. Check both participants see "removed by a moderator".
9. Visit `/account/inquiries`; it should redirect to `/account/messages`.
10. Copy a conversation URL, sign in as a different user and open it; it should show not found.
11. Watch the dev terminal: only ids and outcomes, no message text.
