# S10 — Admin billing

## Goal

Give billing admins (and platform admins) one place to find any payment, see exactly what
happened to it, and resolve the money problems that S5, S6 and S9 deliberately left for a human:
flagged payments, Paybill money that matched no invoice, and the nightly reconciliation report.
Every admin action is audited in `billing_audit_log` and commits in one transaction with its
effects.

Plan v2.0 §9: "Admin billing screen: search payments by phone or receipt, view the event log,
issue credits or refunds, manually activate after a verified Paybill payment. Every action goes in
billing_audit_log."

## References read

- `AGENTS.md` (§6 business rules, §8 security)
- `docs/implementation-plan-v2.md` §4 (payment security, billing rules, lapse table), §6, §9
- `prompts/s2-billing-schema.md` (tables, append-only triggers, invoice terms immutable)
- `prompts/s5-mpesa.md` decisions 6–9 (`confirmPayment`, flag reasons, C2B unmatched → S10)
- `prompts/s6-billing-ui.md` decisions 1, 18, 19 (credit in days, card payments, Paystack refunds
  deferred to S10)
- `prompts/s9-jobs.md` decisions 11–12 (`missing_receipt` flag, reconciliation report → S10)
- Design `3 - Lister & Admin Dashboards/03 — Admin Console & Moderation` (stat cards, table rows,
  Quick actions panel, sidebar nav); compact system `prompts/ui-compact-design-system.md`

## Existing code inspected

- `src/db/schema.ts` billing tables; `drizzle/0002_billing.sql` triggers (payment_events and
  billing_audit_log append-only; invoice amount and plan immutable, status may change)
- `src/lib/mpesa/confirm.ts` (`confirmPayment`, `flagPayment`, lock order payment → invoice →
  subscription), `src/lib/mpesa/c2b.ts` (unmatched Paybill = `c2b_confirmation` event with no
  invoice), `src/lib/mpesa/settle.ts`
- `src/db/queries/payments.ts` (locks, `updatePayment`, `recordPaymentEvent`, `PaymentEventType`)
- `src/db/queries/reconciliation.ts`, `src/lib/jobs/reconciliation.ts` (report payload shape)
- `src/lib/billing/periods.ts` (`subscriptionPhase`, `graceEndsAt`), `plan-change.ts`,
  `payment-view.ts`, `receipts.ts` (`receiptAfterConfirm`)
- `src/app/admin/*` (layout, overview, moderation queue and review page, `actions.ts`),
  `src/components/admin/*` (AdminNav, StatCard, DecisionForms), `src/lib/session.ts`,
  `src/lib/roles.ts` (`ADMIN_ROLES`), `src/lib/action-state.ts`, `src/lib/kenya.ts`

## Decisions and assumptions

1. **Who:** `billing_admin` and `platform_admin` (AGENTS.md §8). Every page and Server Action
   calls `requireRole(ADMIN_ROLES)`; anyone else gets the existing 404. The actor id always comes
   from the session.

2. **Pages** (all `robots: noindex`, data inside `<Suspense>`):
   - `/admin/billing`: search box plus, when no search, a "Needs attention" view: flagged
     payments, unresolved unmatched Paybill payments, and the latest reconciliation report.
   - `/admin/billing/payments/[id]`: payment, invoice, subscription and owner, the full event log,
     billing audit entries, and the actions the payment's state allows.
   - `/admin/billing/paybill/[eventId]`: one unmatched Paybill payment, with "Apply to an invoice"
     and "Record refund".
   - `/admin/billing/record`: "Record a Paybill payment" for money seen on the M-Pesa statement
     when no callback arrived (C2B URLs may not be registered).
   - AdminNav gains **Billing** for both roles. The overview page's "arrives in S10" placeholder
     for billing admins becomes billing stat cards (flagged, unmatched Paybill, reconciliation
     issues). Platform admins keep their moderation overview and get a "Payments and refunds"
     quick action.

3. **Search** (`q`, trimmed, at most 40 characters), classified on the server:
   - `VPK` + 7–9 digits → invoice number (all payments on it, and the invoice even if unpaid)
   - 10 uppercase letters and digits → M-Pesa receipt
   - normalises as a Kenyan phone → `payments.phone_e164`
   - anything else → exact Paystack `provider_reference`
   - Up to 50 payments, newest first: date, method, phone, amount, status, invoice, owner name.
     No match shows an empty state. The query string is never logged.

4. **New payment statuses** `refunded` and `credited`, so a resolved flag leaves the "flagged"
   list and reconciliation's `flagged_open` without rewriting history. `flag_reason` is kept.
   The lister's payment status screen maps them to clear messages ("Refunded" / "Added to your
   plan as extra days").

5. **Actions on a flagged payment** (the panel shows only the ones that apply):

   | Action | Allowed when | Effect |
   |---|---|---|
   | **Activate** (verified on the M-Pesa statement) | flag `missing_receipt` or `callback_query_mismatch`; invoice `open`; amount equals the invoice | Payment back to `pending` with the receipt and amount, then the existing `confirmPayment` (same period, upgrade and listing-restore rules). Anything but `confirmed` rolls the whole transaction back. Receipt email sent after commit. |
   | **Convert to credit** | flag `invoice_not_open` or `amount_mismatch`, paid amount > 0, the invoice's subscription is paid (`active`/`past_due` and not lapsed) | Payment → `credited`; the subscription gets `floor(30 × paid ÷ current plan price)` days (refused if 0) |
   | **Record refund** | any flag, paid amount known or entered | Payment → `refunded` with the refund reference and amount (≤ paid) |
   | **Close, no money kept** | any flag | Payment → `failed`; for duplicates or attempts the admin verified never moved money |

   - The receipt for Activate comes from the stored callback when there is one. When there isn't
     (`missing_receipt`), the admin types it and the amount; both must match the M-Pesa
     statement. A receipt already held by another payment is refused, with a link to it.
   - Activation's `confirmedAt` is the activation time: the lister gets the full period from
     when the money was verified.

6. **Refunds are recorded, not sent.** The admin returns the money outside the app (M-Pesa
   org portal reversal or B2C, or the Paystack dashboard) and records the reference here.
   Calling the Paystack refund API (noted for S10 in S6) and M-Pesa reversal/B2C APIs both need
   credentials and go-live work we don't have; they're deferred to the payments go-live
   checklist. Refunds cover only money that bought nothing (flagged or unmatched). Refunding a
   paid invoice and taking access away is out of scope; the refund policy (go-live checklist)
   decides that process.

7. **Credits are days on a paid period** (consistent with S6's day credits). A goodwill credit is
   1–30 days with a reason, from the subscription panel. It is allowed only on a subscription
   that is `active` or `past_due` and not lapsed, so entitlement still starts from a confirmed
   payment (AGENTS.md §6). It adds the days to `current_period_end`, recomputes `grace_ends_at`,
   and if a downgrade is scheduled for the old period end it moves with it. A lapsed or paused
   subscription is refused: "Credits only extend a paid period. Refund instead, or ask the lister
   to renew."

8. **Unmatched Paybill money** (a `c2b_confirmation` event with no invoice):
   - **Apply to an invoice:** the admin types the invoice number and a reason. The receipt,
     amount and phone are read from the stored event, never from the form. The invoice must be
     `open` and the amount equal. A `manual` payment is inserted with the receipt and confirmed
     through `confirmPayment` in the same transaction. The receipt's uniqueness stops it being
     applied twice.
   - **Record refund:** writes the audit row and an `admin_resolution` payment event
     (`{ sourceEventId, transId, action: "refunded", reference, amountKes }`).
   - An event counts as resolved when a payment holds its TransID as `mpesa_receipt` or an
     `admin_resolution` event names it. The Needs-attention list and reconciliation's
     `unmatched_paybill` check both exclude resolved events.

9. **Record a Paybill payment** (no callback): invoice number, receipt, amount, optional phone,
   reason. Same rules as "Apply to an invoice", with the values typed by the admin. If a
   `c2b_confirmation` event with that TransID exists, the page says so and links it.

10. **Audit and events:**
    - Migration adds `billing_audit_log.reference` (text, ≤ 100) and `credit_days`
      (integer, 1–365).
    - Actions: `activate_payment`, `apply_paybill`, `record_paybill`, `refund_payment`,
      `refund_paybill`, `close_payment`, `credit_from_payment`, `credit_days`.
    - Every payment state change also writes a `status_change` event
      (`{ entity, from, to, by: "admin", action }`).
    - `PaymentEventType` gains `admin_resolution`.
    - Audit reason: 10–500 characters, required. It is shown to admins only.

11. **Event log display:** the payment's and its invoice's events, oldest first, with type, time
    (Nairobi), source IP and the payload as pretty-printed JSON in a closed `<details>`. Payloads
    hold no secrets (the callback token lives in the path, which isn't stored). They can contain
    the payer's phone and name, which billing admins are allowed to see.

12. **Reconciliation report:** the latest `reconciliation` event. Shows when it ran, each check
    with its count (zero shown as a calm "OK", non-zero as a warning badge), IDs as links:
    payment IDs to the payment page, invoice numbers to search, event IDs to the Paybill page.
    Also shows yesterday's confirmed totals by method for the hand check against the statement.
    Shows "No report yet" when the job hasn't run.

13. **Concurrency:** each action runs in one `withTransaction`. It locks in the existing order
    (payment → invoice → subscription) and re-checks state after locking. A second admin acting
    on the same payment sees "Someone already resolved this. Reload to see the latest."

## Files likely to change

- `src/db/schema.ts`; new migration `drizzle/0005_*.sql` (+ meta) via `npm run db:generate`
- `src/db/queries/billing-admin.ts` (new): search, payment detail, event log, audit entries,
  needs-attention lists, latest reconciliation, unmatched events, `insertBillingAudit`
- `src/db/queries/payments.ts` (`PaymentEventType`, `insertManualPayment`)
- `src/db/queries/reconciliation.ts` (`unmatchedPaybill` excludes resolved events)
- `src/lib/billing/credit.ts` (new, pure): `creditDaysFromPayment`, `extendPeriodByDays`
- `src/lib/billing/admin-actions.ts` (new, server-only): the eight actions, typed results
- `src/lib/validation/billing-admin.ts` (new): Zod schemas, `classifyBillingSearch`
- `src/app/admin/billing/page.tsx`, `payments/[id]/page.tsx`, `paybill/[eventId]/page.tsx`,
  `record/page.tsx`, `actions.ts`
- `src/components/admin/billing/*` (search form, payment status badge, event log, action forms,
  reconciliation card)
- `src/components/admin/AdminNav.tsx`, `src/app/admin/page.tsx`
- `src/lib/billing/payment-view.ts`, `src/components/billing/PaymentStatusPanel.tsx`,
  `src/db/queries/billing-page.ts` (new statuses)
- Tests: `src/lib/billing/credit.test.ts`, `src/lib/validation/billing-admin.test.ts`,
  `src/lib/billing/admin-actions.integration.test.ts`

## Implementation requirements

- Thin Server Actions: role check → Zod parse → one domain call in a transaction → typed
  `ActionState`; success redirects back to the page with a `notice`.
- Domain functions take `(tx, actorId, input, now)` and return
  `{ ok: true, … } | { ok: false, code }`. User-facing messages live in one map.
- Reuse `confirmPayment` for every activation path; don't duplicate period or restore logic.
- Activation sends the receipt email after commit with `receiptAfterConfirm`.
- Amounts are whole KES integers; phones normalised with `normalizeKenyanPhone`, displayed with
  `displayKenyanPhone`, masked in logs.
- Logs: `[billing-admin] action=… payment=… outcome=…` with no phone, receipt, reason or query.

### UI (compact system, design 03)

- Page H1 `text-display-sm` through `PageHeading`; section headings `text-title`; tables and
  labels `text-small`; meta `text-micro`.
- Search: one `Input` (`h-control`, `rounded`, `border-line-strong`) with a primary `Button`;
  hint "Phone, M-Pesa receipt, invoice number or card reference".
- Tables follow the moderation queue pattern: white `rounded-lg border-line` panel, rows
  `bg-canvas rounded-lg`, uppercase `text-micro` headers from `md`, stacked cards below `md`.
- Status badges: confirmed `success`, pending `neutral`, flagged `warning`, failed/cancelled
  `neutral`, refunded/credited `info` (or the closest existing Badge tones).
- Stat cards reuse `StatCard`. The reconciliation card is a white `rounded-lg` panel at `p-5`.
- Payment page: two columns from `xl` (details and event log | actions and audit), one column
  below. Action forms are stacked sections separated by `border-t border-line`. Destructive
  actions (refund, close) use the `danger` button. Each form has a reason `Textarea` with a
  counter, like `ReasonDecision`.
- Touch targets ≥ 44px (`h-control`). Phone layout single column, no horizontal scroll (JSON
  `<pre>` scrolls inside itself, `text-micro`).
- Colours only from tokens (`emerald-700`, `ink`, `slate-600`, `line`, `warning-text`,
  `mint-50`). No new font sizes.

## Security requirements

- Role check on every page and action. IDs from forms are UUID-validated; amounts, receipts,
  phones and the payment's state are always re-read from the DB inside the transaction.
- The client never supplies credit days, a subscription id, a plan, or an amount for a recorded
  event (Paybill values come from the stored event).
- Audit rows and payment events are append-only (existing triggers). Nothing is deleted.
- No secrets in pages or logs. Search terms, phones, receipts and reasons are never logged.
- Admin pages are `noindex` and dynamic.

## Acceptance criteria

1. A billing admin sees **Billing** in the admin nav and can open every billing page. A lister
   or buyer gets a 404.
2. Searching by an `07…`/`+254…` phone, a receipt, an invoice number or a card reference finds
   the payments.
3. The payment page shows payment, invoice, subscription, owner, every event (oldest first) and
   audit entries.
4. A `missing_receipt` flagged payment with an open invoice can be activated with a receipt and
   matching amount. The plan becomes active for 30 days, paused listings return, an audit row and
   status events are written, and the flag leaves the Needs-attention list.
5. A wrong amount, a closed invoice or a receipt already used is refused with a clear message, and
   nothing changes.
6. An `invoice_not_open` flagged payment converts to credit: the period is extended by the
   computed days, payment `credited`, audit `credit_from_payment` with `credit_days`.
7. Record refund and Close set `refunded` / `failed` with audit rows. Flagged count drops.
8. An unmatched Paybill payment can be applied to an open invoice (activates the plan) or
   recorded as refunded. Either way it leaves the list and the next reconciliation's
   `unmatched_paybill`.
9. A goodwill credit of N days extends an active subscription by N days. A lapsed one is refused.
10. The latest reconciliation report shows with working links.
11. Acting twice (two tabs) changes things once; the second gets the "already resolved" message.
12. Typecheck, lint, unit tests, integration tests and build pass.

## Checks to run

- `npm run db:generate` (commit the migration), then `npm run db:migrate`
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`

## Manual test steps (after implementation)

1. `npm run db:migrate`, then `npm run dev`.
2. Make yourself a billing admin if needed:
   `ADMIN_CREATE_CONFIRM=yes npm run admin:create -- you@example.com --role billing_admin`.
3. Open `/admin` → **Billing**. Check the Needs-attention view and the reconciliation card (run
   `npm run jobs:run -- reconciliation` first to get a report).
4. As a lister, start a plan payment (`/account/billing/checkout`) with the simulator or the
   Daraja sandbox. In `/admin/billing` search the phone, receipt or invoice number and open the
   payment to see its events.
5. Create a flagged payment: start a payment and leave it unconfirmed, then
   `npm run jobs:run -- payment-checks --now <ISO 31+ minutes later>` (with the fake-clock
   confirmation variable) to get `missing_receipt`. Or use `npm run mpesa:simulate` with a wrong
   amount for `amount_mismatch`. Then Activate / Convert to credit / Refund / Close from the
   payment page and watch the audit list.
6. Unmatched Paybill: `npm run mpesa:simulate` a C2B confirmation with an unknown account
   number, then apply it to an open invoice from `/admin/billing/paybill/<id>`.
7. On an active subscription, add a 5-day credit and check the new period end on the lister's
   `/account/billing`.
