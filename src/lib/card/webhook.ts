import "server-only";
import { z } from "zod";
import { findPaymentByProviderReference, recordPaymentEvent } from "@/db/queries/payments";
import { ipAllowed, requestIp } from "@/lib/mpesa/callback-guard";
import { readRawBody } from "@/lib/mpesa/callback-request";
import type { CardDeps } from "./deps";
import { paystackSignatureValid } from "./signature";

/**
 * The Paystack webhook (prompt S6 decision 16). Order matters: the signature is checked on the
 * raw bytes before anything is parsed or recorded (unsigned bodies are untrusted noise), then the
 * IP allowlist, then the event is recorded and acknowledged. Settlement happens after the response.
 */

const eventSchema = z.object({
  event: z.string(),
  data: z.object({ reference: z.string() }).loose().optional(),
});

export type WebhookResult = { status: number; settlePaymentId?: string };

export async function handleCardWebhook(deps: CardDeps | null, request: Request): Promise<WebhookResult> {
  if (!deps) return { status: 404 };
  const body = await readRawBody(request);
  if (!body.ok) return { status: body.status };
  if (!paystackSignatureValid(body.raw, request.headers.get("x-paystack-signature"), deps.settings.secretKey)) {
    console.warn("[card] webhook refused: bad signature");
    return { status: 401 };
  }

  const ip = requestIp(request.headers);
  if (deps.settings.allowedIps && !ipAllowed(ip, deps.settings.allowedIps)) {
    await recordPaymentEvent(deps.db, {
      eventType: "callback_rejected",
      sourceIp: ip,
      payload: { route: "card-webhook", reason: "ip_not_allowed" },
    });
    console.warn("[card] webhook refused: ip not allowed");
    return { status: 403 };
  }

  let json: unknown;
  try {
    json = JSON.parse(body.raw.toString("utf8"));
  } catch {
    return { status: 400 };
  }
  const event = eventSchema.safeParse(json);
  const reference = event.success ? event.data.data?.reference : undefined;
  const payment = reference ? await findPaymentByProviderReference(deps.db, reference) : null;
  await recordPaymentEvent(deps.db, {
    eventType: "card_webhook",
    paymentId: payment?.id,
    invoiceId: payment?.invoiceId,
    sourceIp: ip,
    payload: json,
  });

  const name = event.success ? event.data.event : "unrecognised";
  console.info(`[card] webhook ${name} reference=${reference ?? "-"}${payment ? "" : " (no matching payment)"}`);
  return { status: 200, settlePaymentId: name === "charge.success" && payment ? payment.id : undefined };
}
