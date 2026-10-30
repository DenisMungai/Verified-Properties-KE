import { confirmC2b, recordC2bConfirmation } from "@/lib/mpesa/c2b";
import { handlePaymentCallback } from "@/lib/mpesa/callback-route";

export const maxDuration = 30;

/**
 * Daraja C2B confirmation (prompt S5 decision 8): a completed Paybill payment. Recorded as
 * received, acknowledged, then matched to its invoice and confirmed in one transaction.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  return handlePaymentCallback(request, token, "c2b-confirmation", async (deps, payload, sourceIp) => {
    const c2b = await recordC2bConfirmation(deps, { payload, sourceIp });
    return {
      body: { ResultCode: 0, ResultDesc: "Accepted" },
      later: c2b ? () => confirmC2b(deps, c2b, payload) : undefined,
    };
  });
}
