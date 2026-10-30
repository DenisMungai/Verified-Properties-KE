import { handlePaymentCallback } from "@/lib/mpesa/callback-route";
import { recordStkCallback, settleStkPayment } from "@/lib/mpesa/settle";

/** STK Query retries run after the response; give them room (prompt S5 decision 6). */
export const maxDuration = 30;

/**
 * Daraja STK Push result callback (prompt S5). Records the raw callback, answers Safaricom at
 * once, then confirms the result with STK Query before any payment changes.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  return handlePaymentCallback(request, token, "stk", async (deps, payload, sourceIp) => {
    const recorded = await recordStkCallback(deps, { payload, sourceIp });
    const paymentId = recorded.paymentId;
    return {
      body: { ResultCode: 0, ResultDesc: "Accepted" },
      later: paymentId ? () => settleStkPayment(deps, paymentId) : undefined,
    };
  });
}
