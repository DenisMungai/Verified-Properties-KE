import { connection } from "next/server";
import { z } from "zod";
import { getDb } from "@/db";
import { messageStatus } from "@/db/queries/messaging";
import { errorName } from "@/lib/log";
import { POLICIES, checkRateLimits, rateLimitKey } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/session";

/**
 * Message polling (prompt S15 decision 14): the signed-in user's unread total and, when they are
 * a participant, one conversation's last activity. Counts and a timestamp only, never message
 * text. GET because Server Actions are dispatched one at a time and would queue behind forms.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const conversationParam = z.uuid();

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function GET(request: Request): Promise<Response> {
  // Outside the try, so a build-time prerender interruption isn't caught and logged as a failure.
  await connection();
  try {
    const user = await getCurrentUser();
    if (!user?.emailVerified) return json({ error: "unauthorized" }, 401);

    const limit = await checkRateLimits([[POLICIES.messagePollPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return json({ error: "too_many" }, 429);

    const parsed = conversationParam.safeParse(new URL(request.url).searchParams.get("conversation"));
    return json(await messageStatus(getDb(), user.id, parsed.success ? parsed.data : null));
  } catch (error) {
    console.error("[messaging] status failed", errorName(error));
    return json({ error: "unavailable" }, 500);
  }
}
