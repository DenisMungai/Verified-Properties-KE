# S6 — Pricing and lister billing UI

## Goal

Give listers a complete way to buy, renew and change a listing plan on top of the S5 payment
engine (plan v2.0 §4, §9):

1. A public **pricing page** (`/pricing`) and a signed-in **plan picker / checkout**
   (`/account/billing/checkout`). Listers reach the checkout from every place that refuses to
   publish because of the plan.
2. An STK **"Check your phone" flow** that polls the payment until it is confirmed, cancelled, failed
   or flagged. When the request times out, it shows the Paybill fallback.
3. A **billing page** (`/account/billing`, "Subscription & billing"). It shows:
   - the current plan, renewal date and status
   - active listings against the limit
   - invoices and receipts
   - **Renew** and **Change plan** buttons
4. **Plan changes:**
   - An **upgrade** takes effect when the payment is confirmed, and the unused days of the current
     plan are credited.
   - A **downgrade** is scheduled for the end of the period and nothing is paid now. When it takes
     effect with more live listings than the new limit, the **lister chooses** which stay live.
5. A **receipt email** through Resend when a payment is confirmed, plus a printable receipt page.
6. **Card payments (Visa and Mastercard, credit or debit) through Paystack**, as a second way to
   pay the same invoice:
   - Paystack's hosted checkout, so card details never reach our servers.
   - The server confirms with Paystack's Verify Transaction API before anything activates.
   - Confirmation runs through the same `confirmPayment` transaction as M-Pesa.
   - This was added at your request. It brings forward the plan's Phase 5 "Card payments through
     Paystack", and decision 14 records it.

**Not in this slice:**
- reminders, grace expiry, and automatic downgrade selection after 3 days (S9 jobs)
- admin credits, refunds and manual activation (S10)
- buying verification (Phase 2). The billing page shows the verification card as "coming soon"
  and never claims anyone is verified.
- SMS receipts (optional, Phase 2 with Africa's Talking)
- KRA eTIMS tax invoices. The receipt is a payment receipt only. The accountant check stays on the
  launch list.

## References read

- `AGENTS.md` sections 1–10 (§6 payments, entitlement and lapse; §7 money and time; §8 security).
- Plan v2.0:
  - §1: plan tiers and who each suits
  - §4: the payment flow (step 6 is the on-screen confirmation and receipt), billing rules
    (upgrade now with credit, downgrade at period end, receipts carry invoice number, plan, period
    and amount) and the lapse table ("if a downgrade leaves more live listings than the new plan
    allows, the lister chooses which stay live; otherwise the newest after 3 days")
  - §9: "Pricing page and plan picker, shown when a lister first tries to publish"; "Lister billing
    page: current plan, renewal date, active listings against the limit, invoices and receipts,
    Renew and Change plan buttons"
- Slice plan `~/.claude/plans/above-is-the-scope-immutable-torvalds.md`, S6 and S9 (S9 owns the
  3-day automatic downgrade selection).
- Design `3 - Lister & Admin Dashboards/02 — Billing & Verification` and `01 — Lister Dashboard`
  (the sidebar, stat cards, row table style). The billing mock has a defect: the oversized
  "Admin-review badge appears" text spills out of the verification card. The intended card is a
  Soft-green panel with a heading, a short line and a status chip, and that is what gets built.
- Design system sheet, `Button - Primary/Secondary/Quiet`, `Status badges`, `Accessibility
  principles`.
- Plan v2.0 §2 (Payments row) and §4 (optional auto-renewal): "Card payments through Paystack are
  an optional Phase 5 addition". You asked for them now. Auto-renewal with saved cards stays in
  Phase 5.
- Paystack docs, read online on 2026-10-30:
  - **Initialize:** `POST https://api.paystack.co/transaction/initialize`, Bearer secret key.
    The body carries `email` (required), `amount` (required, in the currency's **subunit**, so
    KES × 100), `currency`, `reference` (unique; letters, digits and `-` `.` `=` only),
    `callback_url`, `channels` and `metadata`. It returns `authorization_url`, `access_code` and
    `reference`.
  - **Verify:** `GET /transaction/verify/:reference`. Returns `status`, `amount`, `currency`,
    `paid_at`, `channel`, `id` (a 64-bit unsigned integer) and `authorization` (`last4`, `brand`,
    `card_type`, `bank`, …).
  - **Webhooks:** the `x-paystack-signature` header is a hex HMAC-SHA512 of the raw body, keyed
    with the secret key. Source IPs are `52.31.139.75`, `52.49.173.169` and `52.214.14.220`, in
    both test and live mode. Answer `200` quickly. Without it, Paystack retries for 72 h (live)
    or 10 h (test). The event we need is `charge.success`.
  - **Kenya:** Paystack holds a CBK payment-service-provider authorisation, accepts Visa and
    Mastercard (and American Express) and settles in KES. Test keys and test cards work
    without real money.
- Next 16 docs:
  - `02-guides/server-actions.md`: actions are dispatched **one at a time per client**, so a poll
    must be short and must never overlap the pay action.
  - `02-guides/client-side-data-fetching/index.md`: no library is needed for a single-screen poll.
  - `02-guides/forms.md`
  - `01-getting-started/05-server-and-client-components.md`

## Existing code inspected

- **S5 domain:**
  - `src/lib/mpesa/start-payment.ts`. Today a paid subscription on another plan returns
    `plan_change_unavailable`. It reuses or voids open invoices and has a 90 s in-flight guard.
  - `confirm.ts`: `confirmPayment` (lock order payment → invoice → subscription; `nextPeriod`;
    `restorePausedListings`).
  - `settle.ts`: `settleStkPayment` is safe to re-run. Polling may call it.
  - `c2b.ts`: `confirmC2b`.
  - `deps.ts`: `PaymentDeps`.
  - `src/lib/mpesa/callback-route.ts`: the routes' `after()` wrapper.
- `src/app/account/billing/actions.ts`: `startPlanPaymentAction`, the S5 stub for S6.
- `src/db/queries/payments.ts`: invoice, payment and lock helpers; `restorePausedListings`;
  `invoiceStatus`.
- `src/db/queries/billing.ts`:
  - `getListingPool`
  - `getListingSubscription`, which joins `plans` on `subscriptions.plan_id`
  - `countActiveListings`, `getPublishEntitlement`, `getListingPlanUsage`, `getActivePlans`
- `src/lib/billing/periods.ts` (`nextPeriod`, `subscriptionPhase`), `entitlements.ts`
  (`canPublish`, `pickListingsToKeep`, `PUBLISH_BLOCK_MESSAGES`) and `constants.ts`.
- Schema and `drizzle/0002_billing.sql`:
  - `subscriptions` has one live row per owner and kind, and no column for a scheduled plan change
  - invoice amount and plan are immutable by trigger
  - `payments` has no user id
  - `agency_members.role`
- **UI:**
  - `src/app/account/layout.tsx` and `AccountNav`, with links from `components/layout/nav.ts`
  - `PageHeading`
  - the `/account` overview (the "Active listings" stat card)
  - `/account/listings`: its error banner maps `?error=<PublishBlockReason>` to
    `PUBLISH_BLOCK_MESSAGES`
  - `PlanUsagePanel`
  - `FormAlert`
  - `ui/*`: `Button`/`buttonClasses`, `Badge`, `Chip`, `Field`, `Input`, `Spinner`, `Skeleton`,
    `EmptyState`, `SegmentedControl`
  - `src/lib/format.ts` (`formatKes`, `formatNairobiDate`, `formatNairobiDateTime`)
- **Email:**
  - `src/lib/email/send.ts`: `createTransport`; Resend, or a console print in dev
  - `templates.ts`: escaped layout and `firstName`
  - Auth sends email fire-and-forget with a logged catch.
- Plan seed: Starter 3, Pro 20, Agency 100 (agency plan), Verification. Sandbox prices are KES 1–3.

## Decisions and assumptions

Please check these when approving. **1, 3, 4, 5 and 14 are the ones most worth your eye.**

1. **Upgrade credit is paid out in days, not shillings.** The upgrade invoice is the new plan's full
   price, so invoices still equal `plans.price_kes` and a Paybill payment still matches exactly.
   On confirmation:
   - `creditDays = floor(unusedMs / DAY × lastPaidAmount / newPrice)`, where `lastPaidAmount` is
     the amount of the paid invoice covering now, i.e. what the lister actually paid
   - the new period runs `confirmedAt → confirmedAt + 30 days + creditDays`, and the plan switches
     at once

   Example: 15 days left of a KES 1,000 Starter, upgrading to a KES 3,000 Pro. The credit is worth
   KES 500, which is 5 Pro days, so Pro runs 35 days from today. The checkout shows an estimate
   ("about 5 extra days"); the exact figure is computed at confirmation. The alternative is to
   discount the upgrade invoice instead. That means fractional pro-rating, and an invoice amount
   that differs from the plan price. **Say if you prefer that.**
2. **Which plans count as an upgrade or a downgrade** is decided by `listing_limit` only (higher is
   an upgrade), never by price. Agency pools have only the Agency plan, so they can only renew. A
   user-pool lister moves between Starter and Pro. A pure classifier in
   `src/lib/billing/plan-change.ts` decides the outcome from the current plan, its phase and the
   target plan:

   | Current state | Target | Outcome |
   |---|---|---|
   | No subscription | any eligible | `new` |
   | `pending` (never paid) | other plan | `switch_unpaid` (existing S5 behaviour) |
   | Paid, `active` or `grace` | same plan | `renew` (stacks on the period end) |
   | Paid, `active` or `grace` | higher limit | `upgrade` (now, with credit) |
   | Paid, `active` or `grace` | lower limit | `downgrade` (scheduled, nothing to pay) |
   | Paid but `lapsed` | any plan | `restart` (fresh 30 days from confirmation, no credit) |

3. **Migration `0003_scheduled_plan_change`** adds two columns to `subscriptions`:
   - `scheduled_plan_id uuid` (composite foreign key `(scheduled_plan_id, kind)` → `plans(id, kind)`)
   - `scheduled_change_at timestamptz`

   It also adds checks that both are null or both set, and that the scheduled plan differs from
   `plan_id`. Scheduling sets `scheduled_change_at = current_period_end`.
   - **The effective plan is computed, not written by a job.** `getListingSubscription` returns
     the scheduled plan's limit once `scheduled_change_at <= now`, using one SQL
     `CASE … END` join. Entitlement, usage panels and `restorePausedListings` read that. S9 later
     materialises it (sets `plan_id` and clears the schedule), but correctness doesn't wait for S9.
   - **Cancelling** ("Keep Pro") clears both columns. It is only possible before
     `scheduled_change_at`.
   - **Renewing while a downgrade is scheduled** charges the **scheduled** plan. On confirmation:
     - if `confirmedAt >= scheduled_change_at`: switch `plan_id` now and clear the schedule
     - otherwise keep the schedule; the effective-plan rule switches it at the period end
     - either way the period stacks as a normal renewal
   - **Upgrading while a downgrade is scheduled** clears the schedule.
4. **Choosing which listings stay live after a downgrade:**
   - Before the change date, the billing page says: "From {date} you can keep {n} listings live.
     You'll choose which ones then. Until then all stay live."
   - From the change date, while active listings exceed the new limit, the billing page shows a
     **"Choose which listings stay live"** form:
     - checkboxes, newest first, with the newest `limit` pre-checked
     - the submit button is disabled until exactly `limit` or fewer are checked
     - unchecked listings move to `paused` with `pause_reason = 'over_plan_limit'`. They come back
       through the S5 restore when capacity returns.
   - While over the limit, nothing new can publish (`remaining = 0`, as today). The listings
     already live stay live.
   - S9 picks the newest automatically 3 days after `scheduled_change_at`. S6 shows the deadline:
     "If you don't choose by {date + 3 days}, we'll keep the newest {n}."
5. **Receipt email recipients.** Payments carry no user id:
   - user pool: the subscription owner
   - agency pool: every agency **admin**

   The email is sent once, when `confirmPayment` returns `confirmed`, after the transaction commits.
   That happens in the STK settle path (route `after()` and polling) and the C2B path. A replay
   returns `already_confirmed`, so no duplicate is sent.
   - Send failures are logged as `[billing] receipt email failed` and never undo or block the
     confirmation.
   - Contents: invoice number, plan, period (Nairobi dates), amount, M-Pesa receipt, and a link to
     `/account/billing/receipts/{invoiceNumber}`.
   - No phone number, and the first name only.
6. **Polling** uses a Server Action, `getPaymentStatusAction(paymentId)`, called every 3 s by a
   client component for up to **120 s**:
   - It checks ownership: the payment's invoice must belong to the caller's pool (owner, or a member
     of the owning agency). Otherwise the caller gets `not_found`.
   - It returns only status, invoice number, plan name, amount, period end and a fixed message.
     Never receipts of other people, phones or result descriptions.
   - When the payment is `pending`, its callback is stored and the callback is **more than 10 s
     old** (the route's `after()` should already have settled it), the action runs
     `settleStkPayment`. That covers a lost `after()`. It never re-sends an STK Push.
   - The client never starts a new poll before the previous one returns (Server Actions are
     sequential), and it stops on a terminal state or when the component unmounts.
   - After 120 s it stops and shows: "Still waiting for M-Pesa." The Paybill instructions (business
     number, account = invoice number, exact amount) appear, with a **Check again** button that
     runs one more poll.
7. **Rate limits.** The pay action keeps the S5 policies. The status poll needs no new policy: it
   is session-bound and ownership-checked, and it can run Daraja queries only after a stored
   callback.
8. **Routes:**
   - `/pricing` is public, linked in the main nav ("Pricing") and the footer. It shows plans from
     `getActivePlans("listing")`, read at request time inside `<Suspense>` (no `"use cache"`,
     because a new plan version must show up immediately).
   - `/account/billing` is for listers only (`requireLister`) and is added to `accountLinks` as
     "Subscription & billing" after "My listings".
   - `/account/billing/checkout?plan=<code>` is for listers. With no `plan`, or an ineligible one,
     the picker preselects the sensible default: the current plan for a renewal, or Starter (Agency
     for an agency admin) for a new purchase.
   - `/account/billing/receipts/[invoiceNumber]` is for listers. It renders paid invoices only and
     checks ownership, answering `notFound()` otherwise. It has print styles.
9. **"Shown when a lister first tries to publish":** no automatic redirect. Every place that
   refuses publishing for a plan reason links straight to the picker:
   - the `/account/listings` error banner
   - the submit result on the listing preview step
   - `PlanUsagePanel`
   - the overview's Active listings card

   The links are:

   | Block reason | Link |
   |---|---|
   | `no_plan` | "Choose a plan" → `/account/billing/checkout` |
   | `plan_in_grace` / `plan_lapsed` | "Renew plan" → `/account/billing/checkout?plan=<current>` |
   | `limit_reached` | "Upgrade plan" → `/account/billing/checkout` |
   | `plan_pending` | "View billing" → `/account/billing` |

   A redirect would lose the lister's place. A visible next step is enough.
10. **Agency members who aren't admins** see the billing page read-only: plan, renewal date, usage,
    and "Your agency admin manages this plan." They see no buttons and no invoice amounts, only
    invoice numbers and status. The checkout page shows the same message. Agency admins get the
    full page.
11. **Phone prefill.** The checkout phone field is prefilled from the lister profile's phone
    (displayed in `07xx xxx xxx` format) and can be edited. Nothing is stored back to the profile.
12. **Pricing copy is static, per plan code**, from plan §1:
    - Starter: "Private owners and new agents"
    - Pro: "Independent agents"
    - Agency: "Agencies and developers, shared across members"

    An unknown code shows no line. Prices and limits always come from the database. Every card
    says "per 30 days, paid with M-Pesa. No automatic renewal."
13. **No new rate-limit policies or dependencies.** The receipt link uses `NEXT_PUBLIC_APP_URL`.
    The only new env variables are the Paystack ones in decision 17. Paystack is called with
    `fetch`, with no SDK.

### Card payments (Paystack)

14. **Provider: Paystack, using its hosted (redirect) checkout.**
    - Paystack is the provider plan v2.0 already names. It holds a CBK authorisation and takes
      Visa and Mastercard in KES.
    - The redirect flow means card numbers, CVV and 3-D Secure all happen on Paystack's page.
      We never see or store card data, which keeps us in the lightest PCI scope (SAQ A), and we
      load no Paystack script.
    - `channels: ["card"]` only. M-Pesa stays on Daraja, which is cheaper and already built.
    - The price is the same for both methods. Paystack's card fees come out of our settlement
      and are never added to the lister's price.
    - **Say if you'd rather use another provider (Flutterwave, Pesapal, DPO).** The integration
      stays behind a small `CardGateway` interface, so swapping later stays contained.
15. **Same invoice, either method.** The checkout asks "How do you want to pay?" with a
    `SegmentedControl`: **M-Pesa** (default) or **Card**. Card payments go through the same
    plan-change rules (decision 2) and use the same open invoice and amount. Whichever payment
    confirms first pays the invoice. A second payment that later succeeds on the same invoice is
    flagged `invoice_not_open` for S10 to refund, exactly as S5 does for M-Pesa plus Paybill.
16. **Card flow:**
    1. `startCardPaymentAction({ planCode })`:
       - requires `requireLister`, the same eligibility as M-Pesa, and the S5 per-user payment
         rate limit (the per-phone limit doesn't apply)
       - prepares the invoice in the same transaction as M-Pesa
       - after commit, calls Initialize with:
         - `email` = the signed-in user's account email
         - `amount = invoice.amountKes × 100`, `currency: "KES"`
         - `reference = "VPKC-" + <payment uuid>`
         - `callback_url = {APP_URL}/account/billing/checkout/card-return`
         - `channels: ["card"]`
         - `metadata` = invoice number and payment id only
       - inserts a `pending` `card` payment holding the reference and records a `card_init`
         event
       - returns `authorization_url`, and the client sends the browser there with
         `window.location.assign`. Only a URL on `https://checkout.paystack.com` is accepted.
       - if Initialize fails, records `card_init_failed` and shows "Card payments are unavailable
         right now. Pay with M-Pesa instead."
    2. **Return page** `/account/billing/checkout/card-return?reference=…`:
       - checks the reference format and ownership
       - runs `settleCardPayment`, which calls **Verify**
       - shows the same `PaymentStatusPanel` states. While Paystack still reports
         `ongoing`/`pending`, the panel polls the status action. For a card payment that action
         calls `settleCardPayment`, never more than once every 5 s per payment.
    3. **Webhook** `POST /api/payments/card/webhook`:
       - reads the raw body (32 KB cap)
       - checks `x-paystack-signature` with `timingSafeEqual` on the hex HMAC-SHA512 and answers
         401 on a mismatch, recording nothing because unsigned bodies are untrusted noise
       - checks the IP allowlist (decision 17)
       - records a `card_webhook` event and answers `200` at once
       - for `charge.success`, runs `settleCardPayment` in `after()`
       - other events are recorded and ignored
    4. **`settleCardPayment(deps, paymentId)`** never trusts the webhook or the redirect alone;
       it always calls Verify:

       | Verify result | Outcome |
       |---|---|
       | `status = "success"`, `currency = "KES"`, `amount = invoice.amountKes × 100` | `confirmPayment` |
       | `success` with a different amount or currency | **flagged** `amount_mismatch` |
       | `failed` | payment `failed` |
       | `abandoned` | `cancelled`, so the lister can retry |
       | `ongoing` or `pending` | stays `pending`; safe to run again |
       | Paystack error | stays `pending`; S9 reconciles |

       It records a `card_verify` event with status, amount, currency, channel, `paid_at` and the
       Paystack transaction `id`, kept as a **string**. The 64-bit id is captured from the raw
       text and never passed through `Number`.
    5. On `confirmed`, the receipt email goes out exactly as for M-Pesa.
17. **Configuration and dev mode:**
    - `PAYSTACK_SECRET_KEY` is server-only. `sk_test_…` is test mode and `sk_live_…` is live.
    - `PAYSTACK_WEBHOOK_ALLOWED_IPS`: optional. Defaults to Paystack's three published IPs and is
      enforced whenever a live key is set. With a test key it is enforced only when set, because
      the local tunnel changes the apparent source.
    - With no key, the **Card option is hidden** and the checkout shows M-Pesa only. There is no
      card simulator: Paystack test keys are free on sign-up and are the honest test. The return
      page alone confirms without a webhook, so local testing needs no tunnel.
    - In production with a test key, cards are refused and `[card] test key in production` is
      logged.
    - No public key is needed, because there is no inline popup.
18. **Schema, part of migration `0003`:**
    - `payment_method` gains **`card`**.
    - `payments` gains:
      - `provider_reference text unique`
      - `card_brand text`
      - `card_last4 text`, checked as 4 digits

      These hold display data only; Paystack keeps the card.
    - The `payments_confirmed_has_receipt` check becomes "confirmed requires `confirmed_at` and
      (`mpesa_receipt` or `provider_reference`)".
    - A new check: a `card` payment must have a `provider_reference`.
    - `confirmPayment` takes `receipt: string | null`. A card payment's identity is its unique
      `provider_reference`, which is set at insert, so the duplicate-receipt check applies only to
      M-Pesa.
    - The receipt page and email show "Visa •••• 4081" and the Paystack reference instead of an
      M-Pesa receipt.
19. **What stays out:** saved cards and auto-renewal (`authorization_code` reuse is Phase 5),
    refunds through the Paystack API (S10), and USD pricing.

## Files likely to change

New:
- `drizzle/0003_scheduled_plan_change.sql` (generated) and the matching `src/db/schema.ts` columns.
- `src/lib/billing/plan-change.ts` (pure): `classifyPlanChange`, `upgradeCreditDays`, and
  `checkoutPreview` (the text and amounts the picker shows), plus `plan-change.test.ts`.
- `src/lib/billing/receipts.ts` (`server-only`): `sendPaymentReceipt(deps, paymentId)`.
- `src/lib/email/templates.ts`: `paymentReceiptEmail(...)`, with a test in `email.test.ts`.
- `src/db/queries/billing-page.ts`:
  - `getBillingOverview(db, userId, now)`: plan, phase, schedule, usage, open invoice, role in pool
  - `listInvoices(db, pool, limit)`
  - `getReceipt(db, userId, invoiceNumber)`
  - `getPaymentStatusForUser(db, userId, paymentId)`
  - `listListingsForKeepChoice`
- `src/lib/billing/plan-schedule.ts` (`server-only`): `scheduleDowngrade`, `cancelScheduledChange`,
  `keepListingsAfterDowngrade` (transactions, row locks, `status_change` events with
  `entity: "subscription"`).
- Pages:
  - `src/app/pricing/page.tsx`
  - `src/app/account/billing/page.tsx`
  - `src/app/account/billing/checkout/page.tsx`
  - `src/app/account/billing/receipts/[invoiceNumber]/page.tsx`
- Components in `src/components/billing/`:
  - `PlanCard` (pricing and picker)
  - `CurrentPlanCard`
  - `VerificationCard`
  - `InvoiceTable` (table on desktop, cards on mobile)
  - `PaybillInstructions`
  - `CheckoutForm` (client: picker, phone and pay; switches to the status panel)
  - `PaymentStatusPanel` (client: polling and its states)
  - `KeepListingsForm` (client: checkbox limit)
  - `PlanStatusBadge`
- `src/components/billing/PlanBlockLink.tsx`: maps a `PublishBlockReason` to the next-step link.
- Card payments:
  - `src/lib/card/config.ts`: key, mode (`test`, `live` or `off`) and the allowlist
  - `src/lib/card/gateway.ts`: the `CardGateway` interface
  - `src/lib/card/paystack.ts`: `initialize` and `verify` over `fetch`, 10 s timeout, Zod-parsed,
    with the transaction id taken as a string from the raw JSON text
  - `src/lib/card/signature.ts`: HMAC-SHA512 and `timingSafeEqual` (pure)
  - `src/lib/card/start-card-payment.ts`
  - `src/lib/card/settle-card.ts`
  - `src/lib/card/index.ts`
  - tests: `paystack.test.ts` (mocked `fetch`), `signature.test.ts`, `settle-card.integration.test.ts`
  - `src/test/fake-card-gateway.ts`
- `src/app/api/payments/card/webhook/route.ts`
- `src/app/account/billing/checkout/card-return/page.tsx`
- `src/components/billing/PaymentMethodSwitch.tsx`
- Tests:
  - `src/lib/billing/plan-change.test.ts`
  - `src/lib/billing/billing-ui.integration.test.ts`: upgrade credit, downgrade schedule, cancel,
    renewal on the scheduled plan, effective limit after the change date, keep choice, restart
    after a lapse, status ownership, receipt sent once
  - component-free unit tests for `checkoutPreview`

Changed:
- `src/lib/mpesa/start-payment.ts`:
  - classify with `classifyPlanChange`
  - allow `upgrade`, `restart` and `renew` (a renew charges the scheduled plan when one is set)
  - return `use_schedule` for `downgrade` (the UI calls the schedule action instead)
  - remove `plan_change_unavailable`
- `src/lib/mpesa/confirm.ts`:
  - classify at confirmation (renew / scheduled renew / upgrade with credit / restart)
  - switch `plan_id` and clear the schedule where decision 3 says
  - restore paused listings with the **effective** plan's limit
  - add the plan change to the subscription `status_change` event
- `src/lib/mpesa/settle.ts` and `c2b.ts`: call `sendPaymentReceipt` after a `confirmed` outcome,
  outside the transaction.
- `src/lib/mpesa/deps.ts` and `index.ts`: `email: EmailTransport` and `appUrl`. `src/test/fake-daraja.ts`
  and the S5 integration test's deps get a recording transport.
- `src/db/queries/billing.ts`: `getListingSubscription` returns the effective plan (decision 3).
  `getActivePlans` is unchanged.
- `src/db/queries/payments.ts`: small helpers (`paidInvoiceCovering`, `agencyAdminEmails`,
  `scheduledPlan`), as needed.
- `src/app/account/billing/actions.ts`:
  - `startPlanPaymentAction` returns `paymentId`, `planName` and `outcome`
  - new `getPaymentStatusAction`, `scheduleDowngradeAction`, `cancelScheduledChangeAction` and
    `keepListingsAction`
  - each one calls `requireLister`, validates with Zod and returns typed results
- `src/components/layout/nav.ts` ("Pricing", "Subscription & billing"), `SiteFooter`.
- `/account` overview and `PlanUsagePanel`: a "Manage plan" link and block links.
- `/account/listings/page.tsx` and the listing submit result: `PlanBlockLink`.
- `README.md`: the S6 manual test notes, plus a "Card payments (Paystack)" section covering test
  keys, test cards and webhook setup.
- `src/lib/env.ts` and `.env.example`: `PAYSTACK_SECRET_KEY` and `PAYSTACK_WEBHOOK_ALLOWED_IPS`,
  optional and server-only.
- `src/lib/mpesa/start-payment.ts`: the invoice preparation moves into a shared
  `src/lib/billing/prepare-invoice.ts`, used by both M-Pesa and card.
- `src/lib/mpesa/callback-guard.ts` and `callback-request.ts`: the IP CIDR check and the capped
  body reader are reused by the card webhook (moved to `src/lib/payments/` if that reads better).

## Implementation requirements

### Domain

- `classifyPlanChange({ current, target, now })`. `current` is null or
  `{ plan, status, phase, currentPeriodEnd, scheduledPlanId, scheduledChangeAt }`. Returns
  `{ kind: "new" | "switch_unpaid" | "renew" | "upgrade" | "downgrade" | "restart", chargePlan }`
  (the plan actually invoiced). It is pure and covers every row of the decision 2 table, plus:
  - "renew while scheduled" charges the scheduled plan
  - choosing the current plan while a downgrade is scheduled is a `renew` that also asks the UI to
    offer "Keep {current}"
- `upgradeCreditDays({ now, currentPeriodEnd, paidAmountKes, newPriceKes })`:
  - integer, ≥ 0
  - 0 when the period has ended, when `paidAmountKes` is unknown, or when the new price is 0
  - uses whole-millisecond maths and floors only once, at the end
- `confirmPayment` keeps its lock order and idempotency. New branches:
  - **upgrade:** `invoice.planId ≠ sub.planId`, the subscription is paid and in `active` or
    `grace`, and the invoice plan has a higher limit. Then `plan_id = invoice.planId`, the period
    is `confirmedAt → +30 days + creditDays`, `current_period_start = confirmedAt`, and the
    schedule is cleared.
  - **scheduled renew:** `invoice.planId = sub.scheduledPlanId`. A normal stacked period, plus the
    switch rule from decision 3.
  - **restart:** a different plan on a lapsed or pending subscription. Then `plan_id =
    invoice.planId` and a fresh period from `confirmedAt`.
  - any other different-plan invoice on a paid subscription (only reachable through a stale
    Paybill payment) is treated as a **scheduled renew**, by scheduling that plan for the period
    end. It is never an error once the money has arrived.
- `scheduleDowngrade(deps, userId, planCode)`:
  - same eligibility as start (profile, pool, agency admin, listing plan)
  - locks the subscription; it must be paid, in `active` or `grace`, and the target limit lower
  - voids open invoices for the old plan, so a stale Paybill payment can't renew the plan the
    lister is leaving
  - records a `status_change` event
- `cancelScheduledChange(deps, userId)`: only before `scheduled_change_at`.
- `keepListingsAfterDowngrade(deps, userId, keepIds)`:
  - only when the effective plan's limit is below the active count
  - `keepIds` must be a subset of the pool's active listings, with at most `limit` of them
  - every other active listing is paused (`over_plan_limit`, `paused_at = now`), with rows locked
    `FOR UPDATE`, in one transaction
  - `pending_review` listings count as active and can be kept or paused like published ones

### Pages and components (Server Components unless marked client)

- Every page reads the session and database inside `<Suspense>`, with a skeleton fallback that has
  the same footprint. No route `runtime` or `dynamic` exports.
- `/pricing`:
  - `PageContainer` with the heading "Listing plans" and the line "Drafts are free. Choose a plan
    when you're ready to publish."
  - three `PlanCard`s; a note card for "Verification add-on: coming soon" (no price, no button)
  - the disclosure line "Verified listers rank first in search. Ranking is disclosed on results
    pages." is **omitted** until S7 ships that disclosure
  - CTA per card:
    - signed-out: "Choose {plan}" → `/sign-in?next=/account/billing/checkout?plan=<code>`
    - signed-in lister: straight to checkout
    - signed-in non-lister: to onboarding
- `/account/billing`:
  - `PageHeading`: "Subscription & billing" / "Manage your listing plan, renewals and payment
    history."
  - a grid with `CurrentPlanCard` (2/3 width on xl) and `VerificationCard` (1/3), then a
    downgrade notice or `KeepListingsForm` when relevant, then `PaybillInstructions` when an open
    invoice exists, then `InvoiceTable` with the 24 most recent invoices, newest first, and
    `EmptyState` "No invoices yet"
  - flash results via `?updated=` (scheduled, cancelled, kept, paid), like the listings page
- `CurrentPlanCard`:
  - an eyebrow "Current listing plan" (caption, uppercase, `slate-600`, letter-spaced)
  - the plan name as `text-h2`, then "Up to {n} active property listings"
  - "Renewal date: {date}", or "Expired on {date}" when lapsed, or "Awaiting payment"
  - `PlanStatusBadge` (Active / Renew soon ≤ 5 days / In grace / Expired / Payment pending), using
    the existing badge tones
  - the usage bar (reuse the `PlanUsagePanel` bar markup)
  - actions on the right: secondary **Renew** (hidden for pending) and primary **Change plan**
  - with no subscription: "No listing plan yet. Drafts are free; you'll need a plan to publish."
    and a primary **Choose a plan** button
- `VerificationCard`: a `bg-mint-50` panel with the heading "Lister verification" (`text-h4`,
  `emerald-700`), the line "Paid verification with admin review arrives soon. The badge says
  'Profile verified' and appears only after a review passes.", and a "Not verified" `Badge`.
  No button.
- `InvoiceTable`:
  - desktop: the same row style as the listings table (separated rows on `bg-canvas`, rounded
    ends)
  - columns: Invoice, Billing period ("Pro · 12 Oct – 11 Nov 2026", or "—" while unpaid), Date
    (paid date, or the created date for open/void), Amount (`formatKes`, tabular), Status
    (Paid `emerald-700` / Open `warning-text` / Void `slate-600` / Refunded `slate-600`), and a
    **Receipt** link for paid rows
  - mobile (< md): stacked cards
- Checkout page (`CheckoutForm`, client):
  - a radio group of eligible `PlanCard`s (`role="radiogroup"`, arrow keys work through native
    radios, the selected card has a 2px `emerald-600` ring)
  - each card shows its outcome line from `checkoutPreview`:
    - "Adds 30 days from 12 Nov"
    - "Starts now · about 5 extra days from your current plan"
    - "Starts 12 Nov · nothing to pay now"
    - "Your current plan"
  - a phone `Field` (`inputMode="tel"`, `autoComplete="tel"`, hint "We'll send an M-Pesa request
    to this number.")
  - a "How do you want to pay?" `SegmentedControl` (M-Pesa / Card), shown only when cards are
    configured and the outcome needs a payment. With Card selected, the phone field is replaced by
    "You'll enter your Visa or Mastercard details on Paystack's secure page.", with lock-icon
    text, and the button reads "Pay {KSh x} by card". While redirecting, the button shows a
    spinner and is disabled.
  - a summary line: "You'll pay {KSh x} to Paybill {shortcode}." Amounts come from server props;
    the client only displays them.
  - primary button "Pay {KSh x} with M-Pesa", or "Schedule downgrade" for a downgrade, which
    calls the schedule action and redirects to `/account/billing?updated=scheduled`
  - errors appear in `FormAlert`; field errors are tied to the input with `aria-describedby`
- `PaymentStatusPanel` (client), states:
  - **waiting:** a `Spinner` and "Check your phone". Body: "Enter your M-Pesa PIN on {masked
    phone} to pay {amount} for {plan}." A live region announces state changes politely.
  - **confirmed:** a check icon, "Payment received", "{plan} is active until {date}." Buttons
    "Go to my listings" (primary) and "View billing".
  - **cancelled / failed:** "The payment didn't go through." with the reason phrase (cancelled on
    the phone, or a generic failure) and **Try again**, which returns to the form with the same
    plan.
  - **flagged:** "We received a payment we need to check. Our team will review it. You don't
    need to pay again." No retry button.
  - **timed out:** decision 6, with `PaybillInstructions` and **Check again**.
- `KeepListingsForm` (client): a list of checkboxes (title, location, status badge), a live count
  "{k} of {limit} selected", and a submit button "Keep these live" that is disabled when
  `k > limit`. A server-side recheck runs either way.
- Receipt page:
  - a white card, max width 640px: the brand, "Payment receipt", invoice number, M-Pesa receipt,
    paid at (Nairobi time), plan, period, amount, and the payer account (lister display name or
    agency name)
  - a "Print" button (client `window.print()`)
  - `@media print` hides the site header, footer and account nav

### Design tokens and layout

- Colours: Forest `emerald-600` for primary actions and progress, Deep green `emerald-700` for
  headings on mint and success text, `mint-50` panels, `ink` text, `slate-600` muted, `line`
  borders, `line-strong` on form controls, and `warning-text` for open and renew-soon states.
  `danger` is used only for failure text. No navy.
- Typography: Poppins. `text-h1-sm`/`text-h1` page titles (as `PageHeading`), `text-h2` plan name,
  `text-h3` section titles, `text-h4` card headings, `text-body`/`text-body-sm` content,
  `text-caption` eyebrows and table headers. Amounts and dates use `tabular`.
- Spacing on the 8pt rhythm:
  - cards: `p-6` (`p-4` under md), `rounded-xl`, `border border-line`, `bg-white`
  - grid gaps `gap-6`; table rows `py-3 px-4`
  - controls use `rounded-md` (12px radius) at `h-control` (44px) or `h-control-lg` (48px) for the
    pay button
- Responsive:
  - pricing: 1 column < md, 3 columns ≥ lg (2 at md, with Agency wrapping)
  - billing grid: stacked < xl
  - the checkout picker stacks; the pay button is full width < sm
  - nothing scrolls horizontally at 390px
- Accessibility:
  - one `h1` per page
  - sections labelled by their headings
  - status is never conveyed by colour alone (text labels on badges)
  - focus rings visible
  - the polling panel uses `aria-live="polite"`, and focus moves to the result heading on a
    terminal state
  - touch targets ≥ 44px

## Security requirements

- **Never trusted from the client:** amount, plan id, subscription id, credit days or owner. The
  client sends only a plan code and a phone (pay or schedule), a payment id (poll), or listing ids
  (keep choice), and all of these are checked against the session's pool on the server.
- **Ownership:** the status poll, receipt page and keep form answer "not found" for anything
  outside the caller's pool. The receipt page uses `notFound()`, so nothing about other invoices
  leaks.
- **Agency members who aren't admins** can't pay, schedule, cancel or choose listings, and see no
  amounts. Agency admins act for the agency pool.
- **The status payload** carries no receipt numbers, phones, result descriptions or raw callbacks.
  Only the receipt page shows the M-Pesa receipt, and only to the owner.
- **Receipt email:** escaped HTML; first name only; no phone. Failures never reach the payment
  outcome. Logs carry the invoice number and a masked email only.
- **Every new Server Action:** Zod input (UUIDs, a code regex, at most 100 listing ids), typed
  results, no internal error text.
- **Cards:**
  - Card data never touches our servers (hosted checkout). We store only the brand, the last 4
    digits and the Paystack reference.
  - `PAYSTACK_SECRET_KEY` is never logged and never reaches the browser.
  - The webhook verifies the HMAC on the **raw** body before parsing or recording anything, and
    checks the IP allowlist.
  - Activation always needs a matching Verify response (status, KES, exact amount).
  - The return page is ownership-checked, and a forged `reference` reveals nothing.
  - The client accepts only `https://checkout.paystack.com/` as a redirect target.
  - Logs carry the invoice number, the reference and the outcome, never email addresses in clear
    text.
- **Migration:** the new foreign key and checks protect the schedule. The S5 locks and unique keys
  still guarantee idempotency, and a replay never extends a period or sends a second email.

## Acceptance criteria

1. **Pricing:** `/pricing` lists Starter, Pro and Agency with database prices and limits. Signed
   out, a CTA leads to sign-in and returns to the checkout with the plan preselected.
2. **Blocked-publish links:** when publishing is blocked, the listings banner, the submit result,
   the plan panel and the overview card all show the right next-step link (decision 9).
3. **First purchase:** pay → "Check your phone". The simulator callback confirms it, and the panel
   switches to "Payment received" within one poll after settlement. The billing page then shows
   the plan Active with its renewal date. The invoice table shows the paid invoice with its period
   and a Receipt link. One receipt email is logged (dev console) or sent.
4. **Failed outcomes and timeout:**
   - a cancelled simulation shows "didn't go through" with Try again
   - an amount mismatch shows the flagged message with no retry
   - with no callback, after 120 s the Paybill fallback appears, and Check again works once the
     callback arrives
5. **Renew** stacks 30 days on the current end. **Upgrade** with 15 of 30 days left on a KES
   1,000 plan to a KES 3,000 plan gives a period of 35 days from confirmation. The plan switches,
   and listings paused for the limit are restored up to the new limit.
6. **Downgrade scheduling:**
   - Scheduling a downgrade charges nothing and shows the notice with the change date. "Keep Pro"
     cancels it.
   - Renewing while a downgrade is scheduled invoices the lower plan.
   - After the change date (tested with a fixed clock), the effective limit is the lower plan's,
     the keep form appears, and keeping `n` listings pauses the rest with `over_plan_limit`.
7. **Restart:** a lapsed lister can buy a different plan. It starts fresh from confirmation, with
   no credit.
8. **Agency:** an agency member who isn't an admin sees the read-only billing page with no amounts
   or buttons. An admin can renew the Agency plan.
9. **Ownership:** another user's payment id returns `not_found` from the poll, and another pool's
   invoice number returns 404 on the receipt page.
10. **Idempotency:** a replayed callback after an upgrade changes nothing and sends no second
    email.
11. **Card payments:**
    - With no Paystack key, the checkout shows M-Pesa only.
    - With a test key, **Card** redirects to Paystack. A successful test card returns to
      "Payment received", activates the plan exactly as M-Pesa does, sends one receipt email, and
      the receipt shows "Visa •••• 4081" (or the test card's brand and digits).
    - A declined test card shows "didn't go through" with Try again.
    - Closing the Paystack page leaves the invoice open and payable by either method.
    - A webhook with a bad signature gets 401 and nothing is recorded. A replayed `charge.success`
      changes nothing.
    - A Verify amount different from the invoice is flagged.
    - The integration tests cover these with a fake gateway; the unit tests cover the signature,
      the parsing and the 64-bit id.
12. **Layout:** at 390px and 1280px nothing overflows, every control is at least 44px tall, and
    the pages match design 02 (minus its overflow defect).
13. **Checks:** `typecheck`, `lint`, `test`, `test:integration` and `build` pass, and all S5 tests
    still pass.

## Checks to run

- `npm run db:generate` (commit `0003_*`), then `npm run db:migrate` on the dev branch and the test
  branch
- `npm run typecheck`
- `npm run lint`
- `npm test`
- `npm run test:integration`
- `npm run build`
- A visual check of `/pricing`, `/account/billing`, the checkout and status states, and the receipt
  page at 390px and 1280px, using Edge through `playwright-core` (no Chrome on this machine).

## Manual test steps (after implementation)

Prerequisites: `MPESA_CALLBACK_TOKEN` is set in `.env.local` (S5 step A1), sandbox plans are
seeded (`npm run plans:seed`), `npm run dev` is running, and `npm run db:migrate` has applied
`0003`.

1. Signed out, open `http://localhost:3000/pricing`. Three plans are listed. Click **Choose Pro**,
   sign in as a lister with no plan, and you land on the checkout with Pro selected.
2. On `/account/listings`, submit a draft. The banner says "Choose a listing plan…" with a
   **Choose a plan** link.
3. On the checkout, keep or enter `0712345678` and click **Pay**. The panel shows "Check your
   phone". In another terminal:
   `npm run mpesa:simulate -- --checkout <ws_CO_SIM_… shown in the dev log>`
   The panel turns to "Payment received" within a few seconds. The dev terminal shows the
   development email "Your VerifiedPropertiesKE receipt".
4. `/account/billing` shows Pro, Active, with a renewal date 30 days out, "0 of 20" usage, and the
   paid invoice with a **Receipt** link. Open it and print-preview it: no header or nav.
5. **Renew.** Pay and simulate. The renewal date moves 30 days further, and the table shows two
   paid invoices.
6. **Downgrade.** Change plan → Starter → **Schedule downgrade**. A notice appears with the change
   date. Click **Keep Pro** and the notice disappears. Schedule it again.
7. **Cancelled payment.** Start a payment and simulate with `--result cancelled`. The panel shows
   "didn't go through" with **Try again**.
8. **Timeout.** Start a payment and don't simulate. After 2 minutes the Paybill instructions
   appear. Simulate now and click **Check again**. "Payment received" appears.
9. Run `npm run mpesa:status -- <invoice>` for each invoice and check the database agrees with the
   screen.
10. Resize to 390px wide (DevTools) on pricing, billing and checkout: no sideways scrolling, and
    the buttons are full width.

**Card payments (needs a free Paystack account)**

11. Sign up at paystack.com (select Kenya). In Settings → API Keys & Webhooks, copy the **test**
    secret key into `.env.local` as `PAYSTACK_SECRET_KEY=sk_test_…` and restart `npm run dev`.
12. On the checkout, choose **Card** and click **Pay … by card**. You land on Paystack's test
    checkout. Use the success test card shown on that page or in Paystack's docs ("Test
    Payments"). After paying, you return to the "Payment received" screen. The dev terminal
    shows `[card] verify … outcome=confirmed` and the receipt email. `/account/billing` shows the
    paid invoice, and its receipt shows the card brand and last 4 digits.
13. Repeat with Paystack's **declined** test card. You see "didn't go through" with Try again.
14. Start a card payment and close the Paystack tab. Back on `/account/billing` the invoice is
    still open, and you can pay it with M-Pesa.
15. Optional webhook test:
    - run `cloudflared tunnel --url http://localhost:3000`
    - in the Paystack dashboard, set the test webhook URL to `https://<tunnel>/api/payments/card/webhook`
    - pay with a success card and close the tab **before** the redirect
    - the dev terminal shows `[card] webhook charge.success`, then `confirmed`

    A `curl -X POST` to the webhook with a made-up signature returns 401.

The upgrade credit, the effective plan after the change date, the keep form and the agency cases
need a moved clock. The integration tests cover them, and S11's exit run repeats them on the dev
branch.
