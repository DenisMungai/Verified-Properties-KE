# S5 — M-Pesa Daraja integration

## Goal

Listers pay for a listing plan with M-Pesa, and the server, never the browser, turns a payment
Safaricom has confirmed into an active plan (plan v2.0 §4, §9):

1. A Daraja client in `src/lib/mpesa/`: an OAuth token that is cached, **STK Push**, **STK Push
   Query** and **C2B URL registration**.
2. **Starting a payment** (`startPlanPayment`, plus a Server Action that S6 will call). Price and
   plan come from `plans` when the invoice is created. Starts are rate-limited per user and per
   phone number.
3. **STK callback route.** It checks the secret path token and the IP allowlist, records the raw
   payload in `payment_events`, then confirms the result with STK Push Query. After that it runs
   `confirmPayment` in **one transaction**, which:
   - marks the payment and invoice paid
   - extends the subscription by 30 days
   - restores listings paused by billing, up to the plan limit

   The badge needs no write here, because it is derived.
4. **C2B Paybill fallback.** A lister can pay to the Paybill with their invoice number as the
   account number. Validation and confirmation callbacks match the payment to the invoice.
5. **Idempotent writes.** A repeated callback changes nothing. An amount mismatch is **flagged**
   and activates nothing.
6. **A dev-only Daraja simulator**, so the whole flow works before Daraja credentials exist. This
   follows the same pattern as the S4 local-disk store.

**Not in this slice:**
- the pricing page, plan picker, "check your phone" polling UI, billing page and receipt email (S6)
- upgrades and downgrades with credited days (S6). S5 handles first purchase and renewal of the
  same plan only.
- reminders, pausing listings after grace, reconciliation, and retrying payments stuck in
  pending (S9)
- the admin billing screen: credits, refunds, manual activation (S10)
- buying the verification add-on (Phase 2, because paying for it must start a review)

## References read

- `AGENTS.md`, sections 1–10, and especially §6 (payments, callbacks, entitlement, lapse) and §8.
- Plan v2.0:
  - §2: stack (Daraja STK Push, Upstash rate limits)
  - §3: the WebSocket transaction client is needed for payment confirmation
  - §4: payment flow, payment security, billing rules, lapse table
  - §9: Phase 1 billing bullets and exit criteria ("a duplicate callback does not double-extend
    the plan")
  - §14: cross-cutting payment rules
  - §15: launch checklist, Billing section
- `~/.claude/plans/above-is-the-scope-immutable-torvalds.md`: S5, external accounts (Daraja
  sandbox app, shortcode, passkey, public callback URL) and the payment verification list.
- Next 16 docs: `04-functions/after.md` (work after the response, bounded by the route's
  `maxDuration`) and `03-file-conventions/route.md` (Route Handlers; `params` is a Promise).
- Daraja behaviour, checked online because Safaricom's own pages weren't in the search results,
  so these come from SDK docs:
  - The STK Query response carries only `ResultCode`, `ResultDesc` and the request IDs. **The
    receipt and amount come only from the callback's `CallbackMetadata`.**
  - Common result codes: `0` success, `1032` cancelled by the user, `1037` timeout, `1`
    insufficient balance, `2001` wrong PIN.
  - **Safaricom publishes no official list of callback IPs.** Community sources cite
    `196.201.212.0/24`, `196.201.213.0/24` and `196.201.214.0/24`. Sandbox callbacks may come from
    elsewhere.
  - C2B registration takes a short code, `ResponseType` (`Completed` or `Cancelled`), a
    validation URL and a confirmation URL. Safaricom only calls the validation URL when external
    validation is enabled for the short code.

## Existing code inspected

- `src/db/schema.ts` and `drizzle/0002_billing.sql`:
  - `plans`: versioned, terms immutable by trigger.
  - `subscriptions`: one live row per owner and kind; a paid status requires a period.
  - `invoices`: number `VPK` + 7 digits, which fits the 12-character `AccountReference`; amount
    and plan are immutable.
  - `payments`: unique `checkout_request_id` and `mpesa_receipt`. A `stk_push` row needs a
    checkout ID, `confirmed` needs a receipt, and `flagged` needs a reason.
  - `payment_events` and `billing_audit_log`: append-only, enforced by trigger.
  - `verified_listers_now` and `lister_verified_now()`: the derived badge.
- `src/lib/billing/periods.ts`: `nextPeriod` (an early renewal stacks onto the current end) and
  `subscriptionPhase`. `constants.ts` and `entitlements.ts`: `pickListingsToKeep`, newest first.
- `src/db/queries/billing.ts`: `getListingPool` (an agency member shares the agency's plan),
  `getListingSubscription`, `countActiveListings`.
- `src/db/queries/listings.ts`: the `unpauseListing` pattern (clears `pausedAt` and
  `pauseReason`), and `pauseReason` values `plan_lapsed` and `over_plan_limit`.
- `src/db/tx.ts` (`withTransaction`, WebSocket Pool) and `src/db/executor.ts` (`DbExecutor`).
- `src/lib/env.ts`: the `MPESA_*` variables already exist and are optional.
- `src/lib/kenya.ts`: `normalizeKenyanPhone` gives `e164` and `daraja`; `maskPhone` for logs.
- `src/lib/rate-limit.ts`: `POLICIES`, `checkRateLimits`, hashed keys.
- `src/lib/request.ts` (`clientIp`) and `src/lib/session.ts` (`requireUser`).
- S4's storage selection in `src/lib/storage/index.ts` (dev-only fallback, refused in production)
  and its prompt, as the model for the simulator decision.
- `scripts/create-admin.ts` and `scripts/seed-plans.ts`: operator-script conventions (a
  `*_CONFIRM=yes` gate, the env-file flags).
- `src/db/billing.integration.test.ts`: the rolled-back-transaction test pattern.
- The v1.1 reference has no billing, so there is nothing to adapt from it.

Today `.env` / `.env.local` set only `MPESA_ENV`. No Daraja credentials, callback token or
callback URL are configured.

## Decisions and assumptions

Please check these when approving. Items 3, 6, 9 and 11 are the ones most worth your eye.

1. **Route paths avoid "mpesa", "safaricom" and "query".** Daraja is widely reported to reject
   C2B callback URLs that contain these words. So the callbacks are:
   - `POST /api/payments/stk/[token]`
   - `POST /api/payments/c2b/validation/[token]`
   - `POST /api/payments/c2b/confirmation/[token]`

   This replaces `/api/mpesa/callback/[token]` from the slice plan. The code still lives in
   `src/lib/mpesa/`.
2. **Simulator mode** (same pattern as the S4 dev store):
   - The real client is used when `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`,
     `MPESA_SHORTCODE` and `MPESA_PASSKEY` are all set.
   - Otherwise, **when `NODE_ENV !== "production"`**, a simulator is used. Its STK Push returns
     `ws_CO_SIM_<uuid>` and sends nothing to a phone. Its STK Query reports the result stored from
     that payment's callback.
   - `npm run mpesa:simulate` posts a realistic callback to the real route, so the token check,
     parsing, `after()` and confirmation all run for real.
   - In production with no credentials, payment starts return "M-Pesa payments are not set up
     yet." and log `[mpesa] not configured`. There is never a silent fallback.
   - The simulator still needs `MPESA_CALLBACK_TOKEN`. The callback base URL falls back to
     `NEXT_PUBLIC_APP_URL`.
3. **The IP allowlist** (`MPESA_CALLBACK_ALLOWED_IPS`, a comma-separated list of IPv4 CIDRs):
   - **Production** (`MPESA_ENV=production`): always enforced. If the variable is empty it
     defaults to `196.201.212.0/24,196.201.213.0/24,196.201.214.0/24`. A request from outside the
     list gets 403, and an event is recorded.
   - **Sandbox:** enforced only when the variable is set. Sandbox egress IPs aren't published, and
     the simulator posts from localhost.
   - The client IP is read from `x-real-ip`, falling back to the first `x-forwarded-for` entry.
     Vercel sets both and overwrites any value the client sends. IPv4-mapped IPv6
     (`::ffff:1.2.3.4`) is handled.
   - Because the list isn't official, it is one layer of protection, never the only one. The
     secret token, the Query API and exact invoice matching still apply. **Confirm the ranges with
     Safaricom during go-live** (added to the operator notes).
4. **The secret path token** is compared with `timingSafeEqual` on SHA-256 digests. A wrong token
   gets **404**, so the route's existence isn't revealed. The token is never logged.
5. **Start-payment rules** (`startPlanPayment(deps, { userId, planCode, phone })`):
   - The caller must have a lister profile.
   - Only **listing** plans can be bought; a verification plan returns "coming soon".
   - Pool:
     - User pool: a non-agency plan only.
     - Agency pool: the agency plan only, and only an **agency admin** (`agency_members.role =
       'admin'`) may pay. Members see "Ask your agency admin to renew."
   - The owner's live subscription:
     - **None:** create a `pending` subscription.
     - **`pending` on another plan** (never paid): switch it to the new plan and void its open
       invoices.
     - **Paid** (`active`, `past_due` or `paused`) on the **same** plan: this is a renewal.
     - **Paid on a different plan:** refused with "Changing plan arrives soon. Renew your current
       plan for now." (S6 adds upgrades and downgrades.)
   - **Invoice:** reuse the subscription's open invoice when its plan and amount still match the
     current plan version. Otherwise void the stale ones and create a new invoice with
     `amount_kes = plans.price_kes`. That keeps the Paybill account number stable across retries.
   - **In-flight guard:** if a `pending` STK payment for the invoice is under 90 seconds old,
     return "We've already sent a request to your phone…", with no second push.
   - The steps above run in one transaction, locking the subscription row (`FOR UPDATE`). The
     Daraja call happens **after** commit, because a network call never sits inside a
     transaction.
   - When Daraja accepts (`ResponseCode "0"`), insert the `payments` row (`stk_push`, `pending`,
     checkout and merchant IDs, E.164 phone, amount from the invoice) and an `stk_push` event.
   - When Daraja refuses or errors, record an `stk_push_failed` event on the invoice with a
     sanitised error. The caller gets: "M-Pesa couldn't start the payment. Try again, or pay to
     Paybill {shortcode}, account {invoice number}."
   - If the insert fails after Daraja accepted, the later callback won't match a payment. It is
     still recorded as an unmatched event for S9 and S10. This is accepted.
6. **Confirmation needs the callback and the Query API to agree** (`settleStkPayment(paymentId)`):
   - The first callback for a payment stores its `ResultCode`, `ResultDesc` and metadata
     (receipt, amount, phone, transaction date) on the row. Later callbacks are recorded as
     events only.
   - STK Query is then called up to 3 times (immediately, after 2 s, after 5 s) while Daraja says
     the transaction is still processing or the call errors. The route sets `maxDuration = 30`.

   | Callback | Query | Result |
   |---|---|---|
   | `0` | `0` | `confirmPayment` (decision 7) |
   | non-zero | definitive non-zero | `cancelled` if 1032, otherwise `failed` |
   | `0` | definitive non-zero | **flagged**, `callback_query_mismatch` |
   | non-zero | `0` | **flagged**, `callback_query_mismatch` |
   | any | never answers | stays `pending`; `settleStkPayment` is safe to run again (S6 polling and S9 call it) |

   The Query API never confirms on its own. It doesn't return the receipt or amount, and a
   confirmed payment needs both.
7. **`confirmPayment(tx, paymentId, { receipt, paidAmountKes, confirmedAt })`** is shared by STK
   and C2B and runs inside one `withTransaction`:
   - Lock the payment, then the invoice, then the subscription (`FOR UPDATE`).
   - Payment already `confirmed`: no-op, `{ outcome: "already_confirmed" }`. **This is what stops
     a replayed callback from extending the plan twice.**
   - Payment in any other state that isn't `pending`: no-op.
   - The receipt already belongs to another payment: flag `duplicate_receipt`.
   - Invoice not `open` (for example STK and Paybill both paid it): flag `invoice_not_open`. S10
     credits or refunds it.
   - `paidAmountKes !== invoice.amountKes`, whether under or over: flag `amount_mismatch`. Nothing
     is activated.
   - Otherwise:
     - Period: `nextPeriod({ confirmedAt, currentPeriodEnd })`, using the current end only when
       the subscription is `active` or `past_due`.
     - Payment: `confirmed`, with receipt and `confirmed_at`.
     - Invoice: `paid`, with `period_start`, `period_end` and `paid_at`.
     - Subscription: `active`, with the new `current_period_end` and `grace_ends_at`.
       `current_period_start` is kept when the period runs on without a gap, and otherwise set
       to the new start.
     - **Listing plan:** restore listings in the pool with `status = 'paused'` and `pause_reason`
       in (`plan_lapsed`, `over_plan_limit`). Restore up to `limit − active count`, choosing
       with `pickListingsToKeep` (newest first), then set them `published` and clear the pause
       fields. They were reviewed before they were paused (S3 sends a materially edited paused
       listing back to draft), so they skip review.
     - **The badge** needs no write. `verified_listers_now` reads the now-active subscription.
   - Every change writes a `status_change` event with before and after statuses. Flags write the
     flag reason.
8. **C2B Paybill:**
   - Validation:
     - Match `BillRefNumber` (trimmed, upper-cased) to an **open** invoice with an equal
       `TransAmount`. Accept with `{ ResultCode: "0", ResultDesc: "Accepted" }`.
     - Otherwise reject with `C2B00012` (invalid account number) or `C2B00013` (invalid amount).
       Record a `c2b_validation` event either way.
   - Confirmation:
     - Record a `c2b_confirmation` event and answer `{ ResultCode: 0, ResultDesc: "Accepted" }`
       straight away.
     - Then, in `after()` and one transaction: insert a `c2b_paybill` payment with
       `mpesa_receipt = TransID` (`ON CONFLICT DO NOTHING`; a replayed `TransID` stops there) and
       run `confirmPayment`.
     - An unknown account number is recorded as an event only and logged as
       `[mpesa] unmatched paybill payment` for S10.
     - A fractional amount is flagged.
     - `MSISDN` is stored only if it normalises to a Kenyan number. Newer APIs mask it.
9. **C2B cannot use the STK Query API**, which covers STK only. The real C2B check is the
   Transaction Status API, which is asynchronous and needs initiator credentials and an
   encrypted security credential. For S5, C2B relies on four things together:
   - the secret token
   - the IP allowlist
   - an exact match on invoice number and amount
   - S9's nightly reconciliation

   This is a deliberate gap from the plan's line "confirm every callback with the Query API".
   Adding Transaction Status before go-live is on the launch list. Say if you want it in S5
   instead.
10. **Paybill only.** STK uses `CustomerPayBillOnline`, and `PartyB = BusinessShortCode =
    MPESA_SHORTCODE`, because the C2B fallback needs a Paybill. Till (Buy Goods) is out of scope.
    - `AccountReference` is the invoice number.
    - `TransactionDesc` is the plan name, cut to 13 characters.
    - `Timestamp` is Nairobi local time, `YYYYMMDDHHmmss`.
    - `Password` is `base64(shortcode + passkey + timestamp)`.
11. **No pay button in S5.** The Server Action `startPlanPaymentAction` ships now for S6 to call.
    For manual testing, the dev and operator script `npm run mpesa:pay` calls the same
    `startPlanPayment`:
    - it looks up the user by email
    - it applies the same rate limits
    - it refuses to run when `MPESA_ENV=production`
    - it needs `MPESA_PAY_CONFIRM=yes`

    `npm run mpesa:status -- <invoice>` prints the invoice, its payments and the subscription
    period, so you can check results without SQL.
12. **Rate limits** (new `POLICIES`):

    | Policy | Value |
    |---|---|
    | `paymentStartPerUser` | 5 per 15 minutes |
    | `paymentStartPerPhone` | 3 per 15 minutes |

    Phone numbers are hashed into keys, as emails are today. Callback routes aren't rate-limited:
    they are protected by the token and allowlist, and Safaricom must never be throttled.
13. **The token cache** is in module memory and expires 60 seconds before Daraja's `expires_in`.
    A `401` from Daraja clears the cache and retries once. Every Daraja request has a 10-second
    timeout.
14. **No migration is expected.** The S2 tables already hold everything; new event types are free
    text. If implementation proves otherwise, a migration `0003_*` is generated and reported.
15. **Scripts import app modules that use `server-only`.** They run with
    `node --conditions=react-server`, which makes `server-only` a no-op outside Next. If that
    turns out to break something, the shared modules are split so scripts import only the
    non-`server-only` core.

## Files likely to change

New:
- `src/lib/mpesa/config.ts`: mode selection (`daraja`, `simulator` or `unconfigured`), base URLs
  (sandbox `https://sandbox.safaricom.co.ke`, production `https://api.safaricom.co.ke`),
  callback URLs and the allowlist.
- `src/lib/mpesa/client.ts`: the `DarajaClient` interface and request and response types.
- `src/lib/mpesa/daraja.ts`: the HTTP client (token cache, STK Push, STK Query, C2B register).
- `src/lib/mpesa/simulator.ts`: the dev-only client.
- `src/lib/mpesa/index.ts`: `getDarajaClient()`.
- `src/lib/mpesa/password.ts`: timestamp and password (pure).
- `src/lib/mpesa/payloads.ts`: Zod schemas and extractors for the STK callback, query response and
  C2B bodies (pure).
- `src/lib/mpesa/result-codes.ts`: result code to payment outcome, and retryable query detection
  (pure).
- `src/lib/mpesa/callback-guard.ts`: token and IPv4 CIDR checks (pure).
- `src/lib/mpesa/start-payment.ts`: `startPlanPayment`.
- `src/lib/mpesa/settle.ts`: `recordStkCallback` and `settleStkPayment`.
- `src/lib/mpesa/confirm.ts`: `confirmPayment`.
- `src/lib/mpesa/c2b.ts`: `validateC2b` and `confirmC2b`.
- `src/db/queries/payments.ts`: invoice, payment and event reads and writes, row locks, and
  restoring paused listings. Each function takes a `DbExecutor`.
- `src/app/api/payments/stk/[token]/route.ts`
- `src/app/api/payments/c2b/validation/[token]/route.ts`
- `src/app/api/payments/c2b/confirmation/[token]/route.ts`
- `src/app/account/billing/actions.ts`: `startPlanPaymentAction`.
- `scripts/mpesa-pay.ts`, `scripts/mpesa-simulate.ts`, `scripts/mpesa-status.ts`,
  `scripts/mpesa-register-c2b.ts`.
- Tests:
  - `src/lib/mpesa/*.test.ts`
  - `src/lib/mpesa/payments.integration.test.ts`
  - `src/test/fake-daraja.ts`

Changed:
- `src/lib/env.ts`: `MPESA_CALLBACK_ALLOWED_IPS` and a `requireMpesaConfig()` helper.
- `.env.example`: the allowlist, the simulator note and the sandbox values to use.
- `src/lib/rate-limit.ts`: two policies.
- `package.json`: four scripts.
- `src/db/queries/billing.ts`: only if a small shared helper (for example a locked live
  subscription read) belongs there.
- `README.md`: an "M-Pesa (S5)" section covering the simulator, sandbox, tunnel and C2B
  registration.

## Implementation requirements

### Daraja client (`server-only`)

- `DarajaClient`:
  - `stkPush({ phoneDaraja, amountKes, accountReference, description, callbackUrl })` returns
    `{ ok: true, checkoutRequestId, merchantRequestId, customerMessage }` or
    `{ ok: false, error }`.
  - `stkQuery(checkoutRequestId)` returns
    `{ kind: "result", resultCode, resultDesc } | { kind: "pending" } | { kind: "error" }`.
  - `registerC2bUrls({ validationUrl, confirmationUrl, responseType })`.
- The HTTP client uses `fetch` with `AbortSignal.timeout(10_000)` and Basic auth for the token
  (`/oauth/v1/generate?grant_type=client_credentials`). It calls:
  - `/mpesa/stkpush/v1/processrequest`
  - `/mpesa/stkpushquery/v1/query`
  - `/mpesa/c2b/v2/registerurl`
- Every response is parsed with Zod. Integers sent as strings are accepted, and unknown fields are
  ignored. Errors carry a code and short text only, never request bodies, secrets or full phone
  numbers.
- The simulator lives in its own module and its constructor throws when
  `NODE_ENV === "production"`.

### Domain (`server-only`; the database is passed in as `DbExecutor` or `withTransaction`)

- `startPlanPayment`, `recordStkCallback`, `settleStkPayment`, `confirmPayment`, `validateC2b` and
  `confirmC2b`, as described in decisions 5–8.
- Each takes a `deps` object (`db`, `withTransaction`, `daraja`, `now`, `rateLimiter`), so the
  integration tests run them against the test branch with a fake Daraja client and a fixed clock.
- Results are typed unions, for example
  `{ ok: false, code: "rate_limited" | "plan_not_found" | "plan_change_unavailable" | "agency_admin_only" | "in_flight" | "not_configured" | "daraja_rejected", message }`.
- Logs use the `[mpesa]` prefix with invoice number, checkout ID, outcome and masked phone only.

### Routes (thin)

- `params` is awaited. Each route:
  1. Checks the token (404) and the IP (403, recording an event with `sourceIp`).
  2. Reads at most 32 KB of body (413), then parses JSON (400 on failure, with an event recorded
     when the token passed).
  3. Calls the domain function and returns Safaricom's expected JSON.
- `after()` runs `settleStkPayment` or `confirmC2b`, wrapped so that errors are logged and never
  thrown into the response.
- Only `POST` is exported, plus `export const maxDuration = 30`. The Next 16 docs keep
  `maxDuration` with Cache Components; only `dynamic`, `dynamicParams`, `revalidate` and
  `fetchCache` were removed.

### Server Action (`src/app/account/billing/actions.ts`)

- `"use server"`. Zod input is `{ planCode, phone }`. It calls `requireUser()`, then
  `startPlanPayment`, and returns `{ ok, paymentId, invoiceNumber, amountKes, paybill }` or a
  typed error.
- It never takes an amount, a plan ID or a subscription ID from the client.

### Scripts

- `mpesa:pay -- --email <e> --plan <code> --phone <07…>`: prints the invoice number, checkout ID
  and what to do next.
- `mpesa:simulate -- --checkout <id> [--result success|cancelled|insufficient] [--amount <kes>] [--receipt <code>]`:
  - posts to `http://localhost:3000/api/payments/stk/<token>`
  - `--receipt` lets you replay the same receipt
  - refuses unless the simulator is active
- `mpesa:status -- <invoiceNumber>`
- `mpesa:register-c2b`: registers the three C2B URLs for `MPESA_SHORTCODE` and refuses in
  production unless `MPESA_REGISTER_CONFIRM=yes`.

## Security requirements

- Daraja key, secret and passkey, the callback token, and access tokens are server-only and never
  logged. Phones are masked (`maskPhone`) in logs and events, except the `payments.phone_e164`
  column.
- Raw callback payloads go into `payment_events.payload` as received. They contain the payer's
  phone and name, which is needed for disputes and reconciliation. They are never shown outside
  admin screens (S10).
- Amount, plan and owner always come from the database. The client sends only a plan code and a
  phone number.
- Confirmation is idempotent through the row lock plus the unique checkout ID and receipt. A
  replay never extends a period twice.
- Callback routes:
  - answer 404 on a bad token and 403 on a disallowed IP
  - cap the body size
  - send no error details in responses
- A route failure after recording never loses the payload: the event is written before any
  processing.
- The simulator and simulate script can't run in production. In production without credentials,
  payments are refused.
- Payment starts are rate-limited (per user and per phone). In production, the action fails
  closed when rate limiting is unavailable, as the auth actions already do.

## Acceptance criteria

1. With no credentials in dev, `mpesa:pay` creates:
   - a `pending` subscription
   - an open `VPK…` invoice at the plan's price
   - a `pending` `stk_push` payment
   - an `stk_push` event
2. Running it again within 90 seconds is refused. After that, it reuses the **same** invoice.
3. A simulated success callback leads to a confirmed payment, a paid invoice with a 30-day period,
   and an `active` subscription. The lister's listings page shows the plan as active, so
   publishing is allowed.
4. **Replaying the identical callback** changes nothing: the period end is unchanged and there is
   one confirmed payment. Only extra `stk_callback` events are added.
5. A callback with a different amount gives a `flagged` payment (`amount_mismatch`). The
   subscription stays `pending`, or keeps its old period.
6. A cancelled callback (1032) whose query agrees gives `cancelled`. A success callback whose
   query says failed gives `flagged` (`callback_query_mismatch`).
7. A wrong token returns 404 with nothing recorded. A disallowed IP, when the allowlist is
   enforced, returns 403 and records an event.
8. Renewing early stacks: the new period starts at the old end. Renewing after a lapse starts at
   the confirmation time and restores listings paused for `plan_lapsed`, newest first, up to the
   limit. Listings paused for other reasons stay paused.
9. Agency rules:
   - an agency member who isn't an admin can't pay for the agency's plan
   - a user-pool lister can't buy the agency plan
   - a different plan on a paid subscription is refused
10. C2B:
    - a confirmation with a matching invoice number and amount activates exactly as STK does
    - a replayed `TransID` is ignored
    - an unknown account number is recorded only
    - an amount mismatch is flagged
    - validation accepts or rejects with the right codes
11. A Paybill payment for an invoice that STK already paid is flagged `invoice_not_open`.
12. In production mode with no credentials, starts are refused and the simulator can't be built.
13. Unit and integration tests cover all of the above. `typecheck`, `lint`, `test`,
    `test:integration` and `build` pass.

## Checks to run

- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration` (Neon test branch)
- `npm run build`, because new routes, env and server modules were added

## Manual test steps (after implementation)

**A. Simulator (no Daraja account needed)**

1. In `.env.local`, set `MPESA_CALLBACK_TOKEN` to 32+ random characters, generated with
   `openssl rand -hex 24`. Leave the other `MPESA_*` variables empty and restart `npm run dev`.
2. Sign in as a lister who has a profile but no plan. `/account/listings` shows "Choose a listing
   plan…".
3. PowerShell:
   `$env:MPESA_PAY_CONFIRM="yes"; npm run mpesa:pay -- --email you@example.com --plan starter --phone 0712345678`
   This prints the invoice number and a `ws_CO_SIM_…` checkout ID.
4. `npm run mpesa:simulate -- --checkout ws_CO_SIM_…`
   The dev terminal shows `[mpesa] callback`, `query` and `confirmed`.
   `npm run mpesa:status -- VPK…` shows the invoice paid, the period 30 days long and the
   subscription active.
5. Refresh `/account/listings`. The plan panel reads "0 of 3" and submitting a listing works.
6. Replay with the same receipt:
   `npm run mpesa:simulate -- --checkout ws_CO_SIM_… --receipt <receipt from status>`
   `mpesa:status` shows the **same** period end and one confirmed payment.
7. Start a new payment and simulate `--amount 5`. Status shows the payment **flagged
   (amount_mismatch)** and the period unchanged.
8. Start a new payment and simulate `--result cancelled`. Status shows `cancelled`.
9. Set `MPESA_CALLBACK_ALLOWED_IPS=196.201.214.0/24`, restart, and simulate again. The script
   reports **403**. Remove the variable and restart.

**B. Daraja sandbox (once you have an app)**

1. Create an app on developer.safaricom.co.ke with "M-Pesa Express Sandbox". Put its consumer key
   and secret, `MPESA_SHORTCODE=174379` and the sandbox passkey from the portal into `.env.local`.
2. Expose the dev server with `cloudflared tunnel --url http://localhost:3000` (or ngrok). Set
   `MPESA_CALLBACK_BASE_URL` to the https URL and restart.
3. Run `mpesa:pay` with **your Safaricom number**. Enter the PIN in the prompt on your phone.
   Sandbox charges nothing real. The dev terminal shows callback, query and confirmed;
   `mpesa:status` confirms.
4. C2B (optional; uses the sandbox C2B short code from the portal):
   `npm run mpesa:register-c2b`, then use the portal's C2B simulator with the invoice number as
   the bill reference.

**Operator notes carried forward:** submit the Daraja production go-live application early, and
confirm Safaricom's callback IP ranges during go-live (decision 3).
