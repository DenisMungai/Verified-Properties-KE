import "server-only";
import { dueMessageAlerts, messageAlertState } from "@/db/queries/message-alerts";
import { claimDelivery, finishDelivery, reclaimDelivery, retryableDeliveries, type DeliveryKey } from "@/db/queries/notification-deliveries";
import { resendPaymentReceipt } from "@/lib/billing/receipts";
import {
  ALERT_BATCH,
  ALERT_DELAY_MIN,
  ALERT_MAX_AGE_H,
  HOUR_MS,
  MINUTE_MS,
  RETRY_BATCH,
  type DeliveryStatus,
} from "@/lib/notifications/constants";
import { alertKey, deliverMessageAlert } from "@/lib/notifications/message-alerts";
import { Counter } from "./counter";
import type { JobDeps, JobResult } from "./types";

/**
 * Every 5 minutes (prompt S16 decisions 1–5): email new-message alerts for unread streaks that are
 * due, then retry failed or abandoned message alerts and payment receipts. Each send is claimed in
 * `notification_deliveries` first, so overlapping runs never send twice.
 */

function tally(counter: Counter, prefix: string, status: DeliveryStatus): void {
  counter.add(`${prefix}${status[0].toUpperCase()}${status.slice(1)}`);
}

async function sendDueAlerts(deps: JobDeps, now: Date, counter: Counter): Promise<void> {
  const due = await dueMessageAlerts(
    deps.db,
    { from: new Date(now.getTime() - ALERT_MAX_AGE_H * HOUR_MS), dueBefore: new Date(now.getTime() - ALERT_DELAY_MIN * MINUTE_MS) },
    deps.batchSize ?? ALERT_BATCH,
  );
  counter.add("alertsDue", due.length);
  await counter.each(due, (a) => a.conversationId, async (alert) => {
    if (!(await claimDelivery(deps.db, alertKey(alert), deps.now()))) {
      counter.add("alreadyHandled");
      return;
    }
    tally(counter, "alerts", await deliverMessageAlert(deps, alert));
  });
}

async function retryOne(deps: JobDeps, key: DeliveryKey): Promise<DeliveryStatus> {
  if (key.kind === "payment_receipt") return resendPaymentReceipt(deps, key.ref, key.recipientUserId);
  const alert = await messageAlertState(deps.db, key.ref, key.recipientUserId);
  if (!alert) {
    await finishDelivery(deps.db, key, { status: "skipped", error: "not_found", now: deps.now() });
    return "skipped";
  }
  return deliverMessageAlert(deps, alert);
}

async function retryDeliveries(deps: JobDeps, now: Date, counter: Counter): Promise<void> {
  const due = await retryableDeliveries(deps.db, now, deps.batchSize ?? RETRY_BATCH);
  counter.add("retriesDue", due.length);
  await counter.each(due, (key) => `${key.kind}:${key.ref}`, async (key) => {
    if (!(await reclaimDelivery(deps.db, key, now))) {
      counter.add("alreadyHandled");
      return;
    }
    tally(counter, "retries", await retryOne(deps, key));
  });
}

export async function runNotifications(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const counter = new Counter("notifications");
  await sendDueAlerts(deps, now, counter);
  await retryDeliveries(deps, now, counter);
  return { status: "ok", counts: counter.counts };
}
