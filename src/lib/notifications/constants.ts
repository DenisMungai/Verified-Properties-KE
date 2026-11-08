/** Notification limits (prompt S16 decision 13). Minutes and hours are wall-clock durations. */

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;

/** A message must stay unread this long before it's emailed, so someone reading in-app never is. */
export const ALERT_DELAY_MIN = 5;
/** Unread streaks older than this never alert (no backlog flood when S16 ships). */
export const ALERT_MAX_AGE_H = 24;

/** First try plus two retries. */
export const DELIVERY_MAX_ATTEMPTS = 3;
/** Retry n waits `RETRY_BACKOFF_MIN × attempts` after the last failure: about 10, then 20 minutes. */
export const RETRY_BACKOFF_MIN = 10;
/** A `pending` row this old was abandoned mid-send and may be reclaimed. */
export const STUCK_PENDING_MIN = 15;

/** Queue items waiting longer than this go into the moderators' daily digest. */
export const REVIEW_OVERDUE_H = 24;

export const JOB_RUN_RETENTION_DAYS = 30;
export const DELIVERY_RETENTION_DAYS = 90;
/** A run still `running` after this is shown as "Didn't finish". */
export const JOB_RUN_STUCK_MIN = 15;

export const ALERT_BATCH = 100;
export const RETRY_BATCH = 50;

export type DeliveryKind = "message_alert" | "payment_receipt" | "review_digest";
export type DeliveryStatus = "sent" | "failed" | "skipped";

/** Reasons recorded in `last_error` when an alert is not sent. */
export type SkipReason = "conversation_closed" | "blocked" | "email_unverified" | "read" | "not_found";

/** The backoff a failed delivery waits before its next try. */
export function retryBackoffMs(attempts: number): number {
  return RETRY_BACKOFF_MIN * MINUTE_MS * attempts;
}
