import "server-only";
import { getListingPool } from "@/db/queries/billing";
import { getListerProfile } from "@/db/queries/lister-profiles";
import {
  getActivePlanByCode,
  hasRecentPendingStk,
  insertInvoice,
  insertPendingSubscription,
  insertStkPayment,
  isAgencyAdmin,
  lockLiveSubscription,
  openInvoices,
  recordPaymentEvent,
  switchPendingPlan,
  voidInvoices,
  type Invoice,
  type Plan,
  type SubscriptionOwner,
} from "@/db/queries/payments";
import { formatKes } from "@/lib/format";
import { maskPhone, normalizeKenyanPhone } from "@/lib/kenya";
import { POLICIES, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { CALLBACK_PATHS, callbackUrl } from "./config";
import type { PaymentDeps } from "./deps";

/**
 * Starting an M-Pesa payment for a listing plan (prompt S5 decision 5). The price, plan and owner
 * all come from the database; the caller supplies only a plan code and a phone number. The
 * subscription and invoice are prepared in one transaction; the STK Push is sent after it commits,
 * because a network call never sits inside a transaction.
 */

/** A second STK request for the same invoice is refused for this long. */
export const IN_FLIGHT_SECONDS = 90;

/** TransactionDesc is limited to 13 characters. */
const DESCRIPTION_MAX = 13;

export type StartPaymentCode =
  | "invalid_phone"
  | "rate_limited"
  | "no_profile"
  | "plan_not_found"
  | "plan_not_available"
  | "agency_admin_only"
  | "plan_change_unavailable"
  | "in_flight"
  | "not_configured"
  | "daraja_rejected";

export type StartPaymentResult =
  | {
      ok: true;
      paymentId: string;
      invoiceNumber: string;
      amountKes: number;
      planName: string;
      paybill: string;
      checkoutRequestId: string;
    }
  | { ok: false; code: StartPaymentCode; message: string; invoiceNumber?: string; paybill?: string };

export const NOT_CONFIGURED_MESSAGE = "M-Pesa payments are not set up yet.";

const MESSAGES: Record<Exclude<StartPaymentCode, "rate_limited" | "daraja_rejected">, string> = {
  invalid_phone: "Enter a Kenyan M-Pesa number, like 0712 345 678.",
  no_profile: "Set up your lister profile before choosing a plan.",
  plan_not_found: "That plan isn't available. Choose another plan.",
  plan_not_available: "That plan isn't available for your account.",
  agency_admin_only: "Your agency's plan is paid by an agency admin. Ask them to renew it.",
  plan_change_unavailable: "Changing plan arrives soon. Renew your current plan for now.",
  in_flight: "We've already sent a payment request to your phone. Check your phone, or try again in a minute.",
  not_configured: NOT_CONFIGURED_MESSAGE,
};

function fail(code: Exclude<StartPaymentCode, "rate_limited" | "daraja_rejected">): StartPaymentResult {
  return { ok: false, code, message: MESSAGES[code] };
}

const PAID_STATUSES = new Set(["active", "past_due", "paused"]);

type Prepared = { ok: true; invoice: Invoice } | { ok: false; code: "plan_change_unavailable" | "in_flight" };

/** Locks the owner's subscription, then finds or creates the open invoice for this plan. */
async function prepareInvoice(deps: PaymentDeps, owner: SubscriptionOwner, plan: Plan): Promise<Prepared> {
  const now = deps.now();
  return deps.withTransaction(async (tx) => {
    let sub = await lockLiveSubscription(tx, owner, plan.kind);
    if (!sub) {
      sub = await insertPendingSubscription(tx, owner, plan);
    } else if (sub.planId !== plan.id) {
      if (PAID_STATUSES.has(sub.status)) return { ok: false, code: "plan_change_unavailable" };
      await switchPendingPlan(tx, sub.id, plan.id);
    }

    const open = await openInvoices(tx, sub.id);
    const reusable = open.find((i) => i.planId === plan.id && i.amountKes === plan.priceKes) ?? null;
    await voidInvoices(
      tx,
      open.filter((i) => i.id !== reusable?.id).map((i) => i.id),
      now,
    );
    if (reusable && (await hasRecentPendingStk(tx, reusable.id, new Date(now.getTime() - IN_FLIGHT_SECONDS * 1000)))) {
      return { ok: false, code: "in_flight" };
    }
    const invoice =
      reusable ?? (await insertInvoice(tx, { subscriptionId: sub.id, planId: plan.id, amountKes: plan.priceKes }));
    return { ok: true, invoice };
  });
}

export async function startPlanPayment(
  deps: PaymentDeps | null,
  input: { userId: string; planCode: string; phone: string },
): Promise<StartPaymentResult> {
  if (!deps) return fail("not_configured");
  const phone = normalizeKenyanPhone(input.phone);
  if (!phone) return fail("invalid_phone");

  const limit = await checkRateLimits(
    [
      [POLICIES.paymentStartPerUser, rateLimitKey(input.userId)],
      [POLICIES.paymentStartPerPhone, rateLimitKey(phone.e164)],
    ],
    deps.rateLimiter,
  );
  if (!limit.ok) return { ok: false, code: "rate_limited", message: tooManyAttemptsMessage(limit.retryAfterSeconds) };

  if (!(await getListerProfile(deps.db, input.userId))) return fail("no_profile");
  const plan = await getActivePlanByCode(deps.db, input.planCode);
  if (!plan) return fail("plan_not_found");
  // Verification is bought in Phase 2, where paying starts a review.
  if (plan.kind !== "listing" || plan.priceKes <= 0) return fail("plan_not_available");

  const pool = await getListingPool(deps.db, input.userId);
  if (pool.kind === "agency") {
    if (!(await isAgencyAdmin(deps.db, input.userId, pool.agencyId))) return fail("agency_admin_only");
    if (!plan.isAgencyPlan) return fail("plan_not_available");
  } else if (plan.isAgencyPlan) {
    return fail("plan_not_available");
  }

  const prepared = await prepareInvoice(deps, pool, plan);
  if (!prepared.ok) return fail(prepared.code);
  const { invoice } = prepared;
  const { shortcode } = deps.settings;

  const pushed = await deps.daraja.stkPush({
    phoneDaraja: phone.daraja,
    amountKes: invoice.amountKes,
    accountReference: invoice.invoiceNumber,
    description: plan.name.slice(0, DESCRIPTION_MAX),
    callbackUrl: callbackUrl(deps.settings, CALLBACK_PATHS.stk),
  });

  if (!pushed.ok) {
    await recordPaymentEvent(deps.db, {
      eventType: "stk_push_failed",
      invoiceId: invoice.id,
      payload: { error: pushed.error, phone: maskPhone(phone.e164), amountKes: invoice.amountKes },
    });
    console.error(`[mpesa] stk push failed invoice=${invoice.invoiceNumber} phone=${maskPhone(phone.e164)} error=${pushed.error}`);
    return {
      ok: false,
      code: "daraja_rejected",
      message: `M-Pesa couldn't start the payment. Try again, or pay ${formatKes(invoice.amountKes)} to Paybill ${shortcode}, account ${invoice.invoiceNumber}.`,
      invoiceNumber: invoice.invoiceNumber,
      paybill: shortcode,
    };
  }

  const payment = await insertStkPayment(deps.db, {
    invoiceId: invoice.id,
    phoneE164: phone.e164,
    checkoutRequestId: pushed.checkoutRequestId,
    merchantRequestId: pushed.merchantRequestId,
    amountKes: invoice.amountKes,
  });
  await recordPaymentEvent(deps.db, {
    eventType: "stk_push",
    paymentId: payment.id,
    invoiceId: invoice.id,
    payload: {
      checkoutRequestId: pushed.checkoutRequestId,
      merchantRequestId: pushed.merchantRequestId,
      phone: maskPhone(phone.e164),
      amountKes: invoice.amountKes,
      accountReference: invoice.invoiceNumber,
      client: deps.daraja.kind,
    },
  });
  console.info(
    `[mpesa] stk push sent invoice=${invoice.invoiceNumber} checkout=${pushed.checkoutRequestId} phone=${maskPhone(phone.e164)}`,
  );

  return {
    ok: true,
    paymentId: payment.id,
    invoiceNumber: invoice.invoiceNumber,
    amountKes: invoice.amountKes,
    planName: plan.name,
    paybill: shortcode,
    checkoutRequestId: pushed.checkoutRequestId,
  };
}
