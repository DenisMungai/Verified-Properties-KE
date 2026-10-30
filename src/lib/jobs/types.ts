import type { BillingDeps } from "@/lib/billing/deps";
import type { CardDeps } from "@/lib/card/deps";
import type { PaymentDeps } from "@/lib/mpesa/deps";
import type { SmsTransport } from "@/lib/sms/send";
import type { ObjectStore } from "@/lib/storage/object-store";

/**
 * Background jobs (prompt S9). Each job selects only rows still to do, then locks and re-checks
 * each one before writing, so a QStash retry or an overlapping run finds nothing left.
 */

export const JOB_NAMES = [
  "grace-expiry",
  "plan-changes",
  "renewal-reminders",
  "payment-checks",
  "reconciliation",
  "storage-cleanup",
] as const;

export type JobName = (typeof JOB_NAMES)[number];

export function isJobName(value: string): value is JobName {
  return (JOB_NAMES as readonly string[]).includes(value);
}

export interface JobDeps extends Pick<BillingDeps, "db" | "withTransaction" | "now" | "email" | "appUrl"> {
  sms: SmsTransport;
  /** Null when M-Pesa is not set up here. Its `now` must be the job's clock. */
  payments: PaymentDeps | null;
  /** Null when card payments are off. */
  card: CardDeps | null;
  /** Null when object storage is not configured (production without R2). */
  storage: { public: ObjectStore; private: ObjectStore } | null;
  /** Overrides the job's default batch size (tests, `jobs:run --batch`). */
  batchSize?: number;
}

/** Counts and ids only: never phones, emails, names or receipts. */
export interface JobSummary {
  job: JobName;
  status: "ok" | "skipped";
  durationMs: number;
  counts: Record<string, number>;
  ids?: Record<string, string[]>;
}

export type JobResult = Omit<JobSummary, "job" | "durationMs">;

export type JobRun = (deps: JobDeps) => Promise<JobResult>;
