import "server-only";
import { claimDelivery, finishDelivery } from "@/db/queries/notification-deliveries";
import { overdueReviewQueues, reviewDigestRecipients, type OverdueQueue } from "@/db/queries/review-digest";
import { maskEmail } from "@/lib/email/send";
import { reviewDigestEmail, type ReviewQueueLine } from "@/lib/email/templates";
import { HOUR_MS, REVIEW_OVERDUE_H } from "@/lib/notifications/constants";
import { errorName } from "@/lib/notifications/deps";
import { nairobiDateKey, waitLabel } from "@/lib/notifications/review-digest";
import { Counter } from "./counter";
import type { JobDeps, JobResult } from "./types";

/**
 * Daily at 08:00 Nairobi (prompt S16 decision 6): one digest per platform admin when listings or
 * verification requests have waited over 24 hours. Keyed by the Nairobi date, so a second run that
 * day sends nothing. A failed digest isn't retried: tomorrow's replaces it.
 */

function line(queue: OverdueQueue, now: Date): ReviewQueueLine {
  return { count: queue.count, oldest: queue.oldest ? waitLabel(queue.oldest, now) : null };
}

export async function runReviewReminders(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const counter = new Counter("review-reminders");
  const queues = await overdueReviewQueues(deps.db, new Date(now.getTime() - REVIEW_OVERDUE_H * HOUR_MS));
  if (queues.listings.count === 0 && queues.verifications.count === 0) {
    return { status: "skipped", counts: { nothingOverdue: 1 } };
  }
  counter.add("listingsOverdue", queues.listings.count);
  counter.add("verificationsOverdue", queues.verifications.count);

  const ref = nairobiDateKey(now);
  const details = { listings: line(queues.listings, now), verifications: line(queues.verifications, now), overdueHours: REVIEW_OVERDUE_H };
  const urls = { listings: `${deps.appUrl}/admin/listings`, verification: `${deps.appUrl}/admin/verification` };
  const recipients = await reviewDigestRecipients(deps.db);

  await counter.each(recipients, (r) => r.userId, async (recipient) => {
    const key = { kind: "review_digest", ref, recipientUserId: recipient.userId } as const;
    if (!(await claimDelivery(deps.db, key, deps.now()))) {
      counter.add("alreadyHandled");
      return;
    }
    try {
      await deps.email({ to: recipient.email, ...reviewDigestEmail(recipient.name, details, urls) });
    } catch (error) {
      const name = errorName(error);
      console.error(`[jobs] review-reminders email failed to=${maskEmail(recipient.email)} error=${name}`);
      await finishDelivery(deps.db, key, { status: "failed", error: name, now: deps.now() });
      counter.add("digestsFailed");
      return;
    }
    await finishDelivery(deps.db, key, { status: "sent", now: deps.now() });
    counter.add("digestsSent");
  });
  return { status: "ok", counts: counter.counts };
}
