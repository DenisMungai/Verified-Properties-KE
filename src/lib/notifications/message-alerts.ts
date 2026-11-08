import "server-only";
import type { MessageAlert } from "@/db/queries/message-alerts";
import { finishDelivery, type DeliveryKey } from "@/db/queries/notification-deliveries";
import { maskEmail } from "@/lib/email/send";
import { messageAlertEmail } from "@/lib/email/templates";
import { conversationHref } from "@/lib/messaging/paths";
import type { DeliveryStatus, SkipReason } from "./constants";
import { errorName, type NotificationDeps } from "./deps";

/**
 * One new-message alert (prompt S16 decisions 2 and 7). The caller has already claimed (or
 * reclaimed) the delivery row; this decides skip or send and records the outcome.
 */

export function alertKey(alert: Pick<MessageAlert, "messageId" | "recipientUserId">): DeliveryKey {
  return { kind: "message_alert", ref: alert.messageId, recipientUserId: alert.recipientUserId };
}

/** Why an alert must not be sent, checked at send time and again on every retry. */
export function alertSkipReason(alert: Pick<MessageAlert, "read" | "closed" | "blocked" | "emailVerified">): SkipReason | null {
  if (alert.read) return "read";
  if (alert.closed) return "conversation_closed";
  if (alert.blocked) return "blocked";
  if (!alert.emailVerified) return "email_unverified";
  return null;
}

export async function deliverMessageAlert(deps: NotificationDeps, alert: MessageAlert): Promise<DeliveryStatus> {
  const key = alertKey(alert);
  const reason = alertSkipReason(alert);
  if (reason) {
    await finishDelivery(deps.db, key, { status: "skipped", error: reason, now: deps.now() });
    return "skipped";
  }
  const url = `${deps.appUrl}${conversationHref(alert.conversationId)}`;
  try {
    await deps.email({
      to: alert.recipientEmail,
      ...messageAlertEmail(alert.recipientName, { listingTitle: alert.listingTitle, unreadCount: alert.unreadCount }, url),
    });
  } catch (error) {
    const name = errorName(error);
    console.error(`[notifications] message alert failed conversation=${alert.conversationId} to=${maskEmail(alert.recipientEmail)} error=${name}`);
    await finishDelivery(deps.db, key, { status: "failed", error: name, now: deps.now() });
    return "failed";
  }
  await finishDelivery(deps.db, key, { status: "sent", now: deps.now() });
  return "sent";
}
