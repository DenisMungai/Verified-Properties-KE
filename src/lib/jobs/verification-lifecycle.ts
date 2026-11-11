import "server-only";
import {
  claimVerificationReminder,
  deleteRequestDocuments,
  expiringRequestIds,
  finishVerificationReminder,
  lifecycleRecipient,
  purgeCandidateIds,
  rereviewReminderCandidates,
  type LifecycleRecipient,
  type VerificationReminderKey,
  type VerificationReminderStatus,
} from "@/db/queries/verification-lifecycle";
import { getOpenRequest, getUnexpiredVerifiedRequest, insertAudit, lockRequest, updateRequest } from "@/db/queries/verification";
import { maskEmail } from "@/lib/email/send";
import { rereviewDueEmail, rereviewDueSms, verificationExpiredEmail } from "@/lib/email/templates";
import { formatNairobiDate } from "@/lib/format";
import { maskPhone } from "@/lib/kenya";
import { providerCode } from "@/lib/monitoring/log-safe";
import { isPurgeDue } from "@/lib/verification/retention";
import { canTransition, rereviewReminderDue } from "@/lib/verification/rules";
import { Counter } from "./counter";
import type { JobDeps, JobResult } from "./types";

/**
 * Verification lifecycle (prompt S13 decision 7), daily. Three independent steps:
 *  1. expire reviews whose 12 months have run out (the badge already dropped by time; this records
 *     it, writes audit `expire` and tells the lister once);
 *  2. re-review reminders 30 and 7 days before a review ends, by email and SMS;
 *  3. delete documents whose retention period has run out (Kenya DPA; policy in retention.ts).
 * Each item is locked and re-checked before writing, so a retry or overlapping run changes nothing.
 */

const EXPIRE_BATCH = 100;
const REMIND_BATCH = 100;
const PURGE_BATCH = 50;
const VERIFICATION_PATH = "/account/verification";

interface Delivery {
  status: VerificationReminderStatus;
  error?: string;
}

const errorName = (e: unknown) => (e instanceof Error ? e.name : "unknown");

async function deliver(deps: JobDeps, key: VerificationReminderKey, counter: Counter, send: () => Promise<Delivery>): Promise<void> {
  if (!(await claimVerificationReminder(deps.db, key))) {
    counter.add(`${key.reminder}${key.channel === "email" ? "Email" : "Sms"}AlreadyHandled`);
    return;
  }
  let delivery: Delivery;
  try {
    delivery = await send();
  } catch (e) {
    delivery = { status: "failed", error: errorName(e) };
  }
  await finishVerificationReminder(deps.db, key, { ...delivery, now: deps.now() });
  counter.add(`${key.reminder}${key.channel === "email" ? "Email" : "Sms"}${delivery.status[0].toUpperCase()}${delivery.status.slice(1)}`);
}

async function sendEmail(deps: JobDeps, requestId: string, to: string, content: { subject: string; html: string; text: string }): Promise<Delivery> {
  try {
    await deps.email({ to, ...content });
    return { status: "sent" };
  } catch (e) {
    console.error(`[jobs] verification-lifecycle email failed request=${requestId} to=${maskEmail(to)} error=${errorName(e)}`);
    return { status: "failed", error: errorName(e) };
  }
}

async function sendSms(deps: JobDeps, requestId: string, recipient: LifecycleRecipient | null, text: string): Promise<Delivery> {
  if (!recipient?.phone) return { status: "skipped", error: "no_phone" };
  const result = await deps.sms({ to: recipient.phone, text });
  if (result.status === "sent") return { status: "sent" };
  if (result.status === "not_configured") return { status: "skipped", error: "sms_not_configured" };
  console.error(`[jobs] verification-lifecycle sms failed request=${requestId} to=${maskPhone(recipient.phone)} error=${providerCode(result.error)}`);
  return { status: "failed", error: result.error };
}

/* 1. Expire ------------------------------------------------------------------ */

type ExpireOutcome = { kind: "skipped" } | { kind: "expired"; listerUserId: string; endedAt: Date };

async function expireOne(deps: JobDeps, id: string, now: Date): Promise<ExpireOutcome> {
  return deps.withTransaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (
      !request ||
      request.status !== "verified" ||
      !request.reviewExpiresAt ||
      request.reviewExpiresAt.getTime() > now.getTime() ||
      !canTransition("verified", "expired")
    ) {
      return { kind: "skipped" };
    }
    await updateRequest(tx, request.id, { status: "expired", endedAt: request.reviewExpiresAt });
    await insertAudit(tx, { requestId: request.id, actorUserId: null, action: "expire", reason: "12-month review ended" });
    return { kind: "expired", listerUserId: request.listerUserId, endedAt: request.reviewExpiresAt };
  });
}

async function runExpire(deps: JobDeps, now: Date, counter: Counter): Promise<void> {
  const ids = await expiringRequestIds(deps.db, now, deps.batchSize ?? EXPIRE_BATCH);
  counter.add("expireCandidates", ids.length);
  await counter.each(ids, (id) => id, async (id) => {
    const outcome = await expireOne(deps, id, now);
    if (outcome.kind === "skipped") {
      counter.add("expireSkipped");
      return;
    }
    counter.add("expired");
    console.info(`[jobs] verification-lifecycle expired request=${id}`);
    // No notice when a newer review already counts, or a re-review is already under way.
    if (await getUnexpiredVerifiedRequest(deps.db, outcome.listerUserId, now)) return;
    if (await getOpenRequest(deps.db, outcome.listerUserId)) return;
    const recipient = await lifecycleRecipient(deps.db, outcome.listerUserId);
    if (!recipient) return;
    const url = `${deps.appUrl}${VERIFICATION_PATH}`;
    await deliver(deps, { requestId: id, reminder: "expired", channel: "email" }, counter, () =>
      sendEmail(deps, id, recipient.email, verificationExpiredEmail(recipient.name, { endedOn: formatNairobiDate(outcome.endedAt) }, url)),
    );
  });
}

/* 2. Re-review reminders ----------------------------------------------------- */

async function runReminders(deps: JobDeps, now: Date, counter: Counter): Promise<void> {
  const candidates = await rereviewReminderCandidates(deps.db, now, deps.batchSize ?? REMIND_BATCH);
  counter.add("reminderCandidates", candidates.length);
  await counter.each(candidates, (c) => c.requestId, async (candidate) => {
    const reminder = rereviewReminderDue(candidate.reviewExpiresAt, now);
    if (!reminder) return;
    const recipient = await lifecycleRecipient(deps.db, candidate.listerUserId);
    const details = { reminder, endsOn: formatNairobiDate(candidate.reviewExpiresAt) };
    const url = `${deps.appUrl}${VERIFICATION_PATH}`;
    const base = { requestId: candidate.requestId, reminder };
    await deliver(deps, { ...base, channel: "email" }, counter, async () =>
      recipient ? sendEmail(deps, candidate.requestId, recipient.email, rereviewDueEmail(recipient.name, details, url)) : { status: "skipped", error: "no_user" },
    );
    await deliver(deps, { ...base, channel: "sms" }, counter, () => sendSms(deps, candidate.requestId, recipient, rereviewDueSms(details, url)));
  });
}

/* 3. Retention ---------------------------------------------------------------- */

async function purgeOne(deps: JobDeps, id: string, now: Date): Promise<string[] | null> {
  return deps.withTransaction(async (tx) => {
    const request = await lockRequest(tx, id);
    if (!request || request.documentsPurgedAt || !isPurgeDue(request, now)) return null;
    const keys = await deleteRequestDocuments(tx, request.id);
    if (keys.length === 0) return null;
    await updateRequest(tx, request.id, { documentsPurgedAt: now });
    await insertAudit(tx, {
      requestId: request.id,
      actorUserId: null,
      action: "purge_documents",
      reason: `${keys.length} ${keys.length === 1 ? "file" : "files"} deleted under the retention policy`,
    });
    return keys;
  });
}

async function runPurge(deps: JobDeps, now: Date, counter: Counter): Promise<void> {
  const ids = await purgeCandidateIds(deps.db, now, deps.batchSize ?? PURGE_BATCH);
  counter.add("purgeCandidates", ids.length);
  await counter.each(ids, (id) => id, async (id) => {
    const keys = await purgeOne(deps, id, now);
    if (!keys) {
      counter.add("purgeSkipped");
      return;
    }
    counter.add("purgedRequests");
    counter.add("purgedFiles", keys.length);
    console.info(`[jobs] verification-lifecycle purged request=${id} files=${keys.length}`);
    if (!deps.storage) {
      counter.add("purgeObjectsLeftForCleanup", keys.length);
      return;
    }
    try {
      await deps.storage.private.delete(keys);
    } catch (e) {
      // The rows are gone, so the nightly storage-cleanup sweep removes the objects after 24h.
      counter.add("purgeObjectsLeftForCleanup", keys.length);
      console.error(`[jobs] verification-lifecycle object delete failed request=${id} error=${errorName(e)}`);
    }
  });
}

export async function runVerificationLifecycle(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const counter = new Counter("verification-lifecycle");
  for (const step of [runExpire, runReminders, runPurge]) {
    try {
      await step(deps, now, counter);
    } catch (e) {
      counter.add("stepFailed");
      console.error(`[jobs] verification-lifecycle step ${step.name} failed error=${errorName(e)}`);
    }
  }
  return { status: "ok", counts: counter.counts };
}
