import { after } from "next/server";
import { invalidatePublicListings } from "@/lib/cache/public-listings";
import { getCardDeps } from "@/lib/card";
import { settleCardPayment } from "@/lib/card/settle-card";
import { handleCardWebhook } from "@/lib/card/webhook";
import { errorName } from "@/lib/log";

/** Verify runs after the response; give it room. */
export const maxDuration = 30;

/**
 * Paystack webhook (prompt S6 decision 16): signature, then IP, then record and answer 200 at
 * once. A `charge.success` is settled through Verify after the response, never on the body alone.
 */
export async function POST(request: Request): Promise<Response> {
  const deps = getCardDeps();
  const result = await handleCardWebhook(deps, request);
  const paymentId = result.settlePaymentId;
  if (deps && paymentId) {
    after(async () => {
      try {
        await settleCardPayment(deps, paymentId, "webhook");
        // A confirmed payment can restore paused listings and the verified badge.
        invalidatePublicListings();
      } catch (error) {
        console.error("[card] webhook processing failed", errorName(error));
      }
    });
  }
  return new Response(null, { status: result.status });
}
