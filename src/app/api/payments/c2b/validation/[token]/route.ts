import { validateC2b } from "@/lib/mpesa/c2b";
import { handlePaymentCallback } from "@/lib/mpesa/callback-route";

/**
 * Daraja C2B validation (prompt S5 decision 8): accept a Paybill payment only when its account
 * number is an open invoice and the amount matches. Safaricom calls this only when external
 * validation is enabled for the short code.
 */
export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }): Promise<Response> {
  const { token } = await params;
  return handlePaymentCallback(request, token, "c2b-validation", async (deps, payload, sourceIp) => ({
    body: await validateC2b(deps, { payload, sourceIp }),
  }));
}
