import "server-only";
import { after } from "next/server";
import { recordPaymentEvent } from "@/db/queries/payments";
import { guardCallback, readJsonBody } from "./callback-request";
import type { PaymentDeps } from "./deps";
import { getMpesaSettings, getPaymentDeps } from "./index";

/**
 * Shared shape of the three payment callback routes (prompt S5): guard (404/403), read a capped
 * JSON body (413/400), let the handler record the payload, answer Safaricom, then do the slow
 * work (STK Query, confirmation) after the response. Responses never carry error details.
 */

export interface CallbackHandled {
  body: unknown;
  /** Runs after the response is sent; errors are logged, never thrown. */
  later?: () => Promise<unknown>;
}

export async function handlePaymentCallback(
  request: Request,
  token: string,
  route: string,
  handle: (deps: PaymentDeps, payload: unknown, sourceIp: string | null) => Promise<CallbackHandled>,
): Promise<Response> {
  const deps = getPaymentDeps();
  const guard = guardCallback(deps ? getMpesaSettings() : null, token, request.headers);
  if (!deps || !guard.ok) {
    if (deps && !guard.ok && guard.status === 403) {
      await recordPaymentEvent(deps.db, {
        eventType: "callback_rejected",
        sourceIp: guard.ip,
        payload: { route, reason: "ip_not_allowed" },
      });
      console.warn(`[mpesa] ${route} callback refused: ip not allowed`);
    }
    return new Response(null, { status: guard.ok ? 404 : guard.status });
  }

  const body = await readJsonBody(request);
  if (!body.ok) {
    await recordPaymentEvent(deps.db, {
      eventType: "callback_rejected",
      sourceIp: guard.ip,
      payload: { route, reason: body.status === 413 ? "body_too_large" : "invalid_json" },
    });
    return new Response(null, { status: body.status });
  }

  const handled = await handle(deps, body.json, guard.ip);
  const later = handled.later;
  if (later) {
    after(async () => {
      try {
        await later();
      } catch (error) {
        console.error(`[mpesa] ${route} processing failed`, error instanceof Error ? error.name : "unknown");
      }
    });
  }
  return Response.json(handled.body);
}
