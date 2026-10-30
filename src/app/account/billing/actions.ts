"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb } from "@/db";
import { getPaymentStatusForUser } from "@/db/queries/billing-page";
import { lastEventAt } from "@/db/queries/payments";
import type { ActionState } from "@/lib/action-state";
import { getBillingDeps } from "@/lib/billing/app-deps";
import { paymentView, type PaymentView } from "@/lib/billing/payment-view";
import { cancelScheduledChange, keepListingsAfterDowngrade, scheduleDowngrade } from "@/lib/billing/plan-schedule";
import { getCardDeps } from "@/lib/card";
import { settleCardPayment } from "@/lib/card/settle-card";
import { startCardPayment, type StartCardCode } from "@/lib/card/start-card-payment";
import { maskPhone, normalizeKenyanPhone } from "@/lib/kenya";
import { getPaymentDeps } from "@/lib/mpesa";
import { settleStkPayment } from "@/lib/mpesa/settle";
import { startPlanPayment, type StartPaymentCode } from "@/lib/mpesa/start-payment";
import { RateLimitUnavailableError } from "@/lib/rate-limit";
import { requireLister } from "../listings/guard";

/**
 * Billing Server Actions (prompts S5, S6). The client sends a plan code, a phone, a payment id or
 * listing ids only: never an amount, plan id, subscription id or credit. Every action checks the
 * session and scopes what it reads or changes to the user's own pool.
 */

const BILLING_PATH = "/account/billing";
const GENERIC_FAILURE = "We couldn't start the payment. Please try again.";

const planCodeSchema = z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/, { error: "Choose a plan." });

function logFailure(action: string, error: unknown): void {
  console.error(`[billing] ${action} failed`, error instanceof Error ? error.name : "unknown");
}

/* -------------------------------------------------------------------------- */
/* Paying                                                                     */
/* -------------------------------------------------------------------------- */

export type StartPaymentActionResult =
  | { ok: true; paymentId: string; invoiceNumber: string; amountKes: number; planName: string; paybill: string; maskedPhone: string }
  | { ok: false; code: StartPaymentCode | "invalid" | "unavailable"; error: string; field?: "phone" };

const mpesaInputSchema = z.object({
  planCode: planCodeSchema,
  phone: z.string().trim().min(9, { error: "Enter your M-Pesa number." }).max(20),
});

export async function startPlanPaymentAction(input: { planCode: string; phone: string }): Promise<StartPaymentActionResult> {
  const user = await requireLister(BILLING_PATH);
  const parsed = mpesaInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, code: "invalid", error: issue?.message ?? GENERIC_FAILURE, field: issue?.path[0] === "phone" ? "phone" : undefined };
  }

  try {
    const result = await startPlanPayment(getPaymentDeps(), { userId: user.id, ...parsed.data });
    if (!result.ok) {
      return { ok: false, code: result.code, error: result.message, field: result.code === "invalid_phone" ? "phone" : undefined };
    }
    const phone = normalizeKenyanPhone(parsed.data.phone);
    return {
      ok: true,
      paymentId: result.paymentId,
      invoiceNumber: result.invoiceNumber,
      amountKes: result.amountKes,
      planName: result.planName,
      paybill: result.paybill,
      maskedPhone: phone ? maskPhone(phone.e164) : "your phone",
    };
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("start payment", error);
    return { ok: false, code: "unavailable", error: GENERIC_FAILURE };
  }
}

export type StartCardActionResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; code: StartCardCode | "invalid" | "unavailable"; error: string };

export async function startCardPaymentAction(input: { planCode: string }): Promise<StartCardActionResult> {
  const user = await requireLister(BILLING_PATH);
  const parsed = z.object({ planCode: planCodeSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: "Choose a plan." };

  try {
    const result = await startCardPayment(getCardDeps(), { userId: user.id, email: user.email, planCode: parsed.data.planCode });
    if (!result.ok) return { ok: false, code: result.code, error: result.message };
    return { ok: true, authorizationUrl: result.authorizationUrl };
  } catch (error) {
    if (!(error instanceof RateLimitUnavailableError)) logFailure("start card payment", error);
    return { ok: false, code: "unavailable", error: GENERIC_FAILURE };
  }
}

/* -------------------------------------------------------------------------- */
/* Status polling (decision 6)                                                */
/* -------------------------------------------------------------------------- */

/** The route's after() should have settled a callback by now; past this the poll does it. */
const STK_SETTLE_AFTER_MS = 10_000;
/** At most one Paystack Verify per payment in this window. */
const CARD_VERIFY_EVERY_MS = 5_000;

export type PaymentStatusResult = { ok: true; payment: PaymentView } | { ok: false; code: "not_found" };

async function settleIfDue(paymentId: string, row: { method: string; status: string; hasCallback: boolean }): Promise<void> {
  if (row.status !== "pending") return;
  const db = getDb();
  const now = Date.now();
  if (row.method === "stk_push" && row.hasCallback) {
    const at = await lastEventAt(db, paymentId, "stk_callback");
    const deps = getPaymentDeps();
    if (deps && at && now - at.getTime() > STK_SETTLE_AFTER_MS) await settleStkPayment(deps, paymentId);
  } else if (row.method === "card") {
    const at = await lastEventAt(db, paymentId, "card_verify");
    const deps = getCardDeps();
    if (deps && (!at || now - at.getTime() > CARD_VERIFY_EVERY_MS)) await settleCardPayment(deps, paymentId, "poll");
  }
}

export async function getPaymentStatusAction(paymentId: string): Promise<PaymentStatusResult> {
  const user = await requireLister(BILLING_PATH);
  if (!z.uuid().safeParse(paymentId).success) return { ok: false, code: "not_found" };
  const db = getDb();
  const row = await getPaymentStatusForUser(db, user.id, paymentId);
  if (!row) return { ok: false, code: "not_found" };
  try {
    await settleIfDue(paymentId, row);
  } catch (error) {
    logFailure("payment status settle", error);
  }
  const fresh = (await getPaymentStatusForUser(db, user.id, paymentId)) ?? row;
  return { ok: true, payment: paymentView(fresh) };
}

/* -------------------------------------------------------------------------- */
/* Plan changes                                                               */
/* -------------------------------------------------------------------------- */

export type ScheduleActionResult = { ok: false; error: string };

export async function scheduleDowngradeAction(input: { planCode: string }): Promise<ScheduleActionResult> {
  const user = await requireLister(BILLING_PATH);
  const parsed = z.object({ planCode: planCodeSchema }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Choose a plan." };
  let result;
  try {
    result = await scheduleDowngrade(getBillingDeps(), user.id, parsed.data.planCode);
  } catch (error) {
    logFailure("schedule downgrade", error);
    return { ok: false, error: "We couldn't schedule the change. Please try again." };
  }
  if (!result.ok) return { ok: false, error: result.message };
  redirect(`${BILLING_PATH}?updated=scheduled`);
}

export async function cancelScheduledChangeAction(): Promise<void> {
  const user = await requireLister(BILLING_PATH);
  let ok = false;
  try {
    ok = (await cancelScheduledChange(getBillingDeps(), user.id)).ok;
  } catch (error) {
    logFailure("cancel scheduled change", error);
  }
  redirect(`${BILLING_PATH}?${ok ? "updated=cancelled" : "error=cancel_failed"}`);
}

const keepSchema = z.array(z.uuid()).max(100);

export async function keepListingsAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireLister(BILLING_PATH);
  const parsed = keepSchema.safeParse(formData.getAll("keep"));
  if (!parsed.success) return { formError: "Choose listings from the list." };
  let result;
  try {
    result = await keepListingsAfterDowngrade(getBillingDeps(), user.id, parsed.data);
  } catch (error) {
    logFailure("keep listings", error);
    return { formError: "Something went wrong. Please try again." };
  }
  if (!result.ok) return { formError: result.message };
  redirect(`${BILLING_PATH}?updated=kept`);
}
