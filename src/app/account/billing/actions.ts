"use server";

import { z } from "zod";
import { RateLimitUnavailableError } from "@/lib/rate-limit";
import { getPaymentDeps } from "@/lib/mpesa";
import { startPlanPayment, type StartPaymentCode } from "@/lib/mpesa/start-payment";
import { requireLister } from "../listings/guard";

/**
 * Billing Server Actions (prompt S5; the pricing UI that calls them arrives in S6). The client
 * sends a plan code and a phone number only: never an amount, plan id or subscription id.
 */

export type StartPaymentActionResult =
  | { ok: true; paymentId: string; invoiceNumber: string; amountKes: number; paybill: string }
  | { ok: false; code: StartPaymentCode | "invalid" | "unavailable"; error: string };

const GENERIC_FAILURE = "We couldn't start the payment. Please try again.";

const inputSchema = z.object({
  planCode: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/, { error: "Choose a plan." }),
  phone: z.string().trim().min(9, { error: "Enter your M-Pesa number." }).max(20),
});

export async function startPlanPaymentAction(input: { planCode: string; phone: string }): Promise<StartPaymentActionResult> {
  const user = await requireLister("/account/listings");
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "invalid", error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };

  try {
    const result = await startPlanPayment(getPaymentDeps(), { userId: user.id, ...parsed.data });
    if (!result.ok) return { ok: false, code: result.code, error: result.message };
    return {
      ok: true,
      paymentId: result.paymentId,
      invoiceNumber: result.invoiceNumber,
      amountKes: result.amountKes,
      paybill: result.paybill,
    };
  } catch (error) {
    if (error instanceof RateLimitUnavailableError) return { ok: false, code: "unavailable", error: GENERIC_FAILURE };
    console.error("[mpesa] start payment failed", error instanceof Error ? error.name : "unknown");
    return { ok: false, code: "unavailable", error: GENERIC_FAILURE };
  }
}
