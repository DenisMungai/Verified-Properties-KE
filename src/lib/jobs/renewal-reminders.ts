import "server-only";
import { reminderCandidates, type ReminderCandidate } from "@/db/queries/jobs";
import {
  claimReminder,
  finishReminder,
  reminderRecipients,
  type ReminderKey,
  type ReminderRecipient,
  type ReminderStatus,
} from "@/db/queries/reminders";
import { DAY_MS } from "@/lib/billing/constants";
import { maskEmail } from "@/lib/email/send";
import { renewalReminderEmail, renewalReminderSms } from "@/lib/email/templates";
import { formatKes, formatNairobiDate } from "@/lib/format";
import { maskPhone } from "@/lib/kenya";
import { Counter } from "./counter";
import { REMINDER_LEAD_DAYS, reminderDue, type DueReminder } from "./reminder-window";
import type { JobDeps, JobResult } from "./types";

/**
 * Renewal reminders 5 days and 1 day before a listing plan ends (plan v2.0 §4; prompt S9
 * decisions 7–10), by email and, when configured, SMS. Each channel is claimed in
 * `billing_reminders` before sending, so a retry or an overlapping run never sends twice. The
 * Renew link opens the checkout page; it never starts a payment from a GET.
 */

const BATCH = 100;

interface Delivery {
  status: ReminderStatus;
  error?: string;
}

function renewUrl(deps: JobDeps, candidate: ReminderCandidate): string {
  return `${deps.appUrl}/account/billing/checkout?plan=${encodeURIComponent(candidate.planCode)}`;
}

async function sendEmails(deps: JobDeps, candidate: ReminderCandidate, reminder: DueReminder, recipients: ReminderRecipient[]): Promise<Delivery> {
  if (recipients.length === 0) return { status: "skipped" };
  const details = {
    planName: candidate.planName,
    reminder,
    endsOn: formatNairobiDate(candidate.periodEnd),
    price: formatKes(candidate.priceKes),
  };
  let sent = 0;
  let error: string | undefined;
  for (const recipient of recipients) {
    try {
      await deps.email({ to: recipient.email, ...renewalReminderEmail(recipient.name, details, renewUrl(deps, candidate)) });
      sent += 1;
    } catch (e) {
      error = e instanceof Error ? e.name : "unknown";
      console.error(`[jobs] renewal-reminders email failed subscription=${candidate.subscriptionId} to=${maskEmail(recipient.email)} error=${error}`);
    }
  }
  return sent > 0 ? { status: "sent" } : { status: "failed", error };
}

async function sendSms(deps: JobDeps, candidate: ReminderCandidate, recipients: ReminderRecipient[]): Promise<Delivery> {
  const phones = [...new Set(recipients.map((r) => r.phone).filter((p): p is string => Boolean(p)))];
  if (phones.length === 0) return { status: "skipped", error: "no_phone" };
  const text = renewalReminderSms({ planName: candidate.planName, endsOn: formatNairobiDate(candidate.periodEnd) }, `${deps.appUrl}/account/billing`);
  let sent = 0;
  let notConfigured = 0;
  let error: string | undefined;
  for (const to of phones) {
    const result = await deps.sms({ to, text });
    if (result.status === "sent") sent += 1;
    else if (result.status === "not_configured") notConfigured += 1;
    else {
      error = result.error;
      console.error(`[jobs] renewal-reminders sms failed subscription=${candidate.subscriptionId} to=${maskPhone(to)} error=${error}`);
    }
  }
  if (sent > 0) return { status: "sent" };
  if (notConfigured === phones.length) return { status: "skipped", error: "sms_not_configured" };
  return { status: "failed", error };
}

async function deliver(
  deps: JobDeps,
  key: ReminderKey,
  counter: Counter,
  send: () => Promise<Delivery>,
): Promise<void> {
  if (!(await claimReminder(deps.db, key))) {
    counter.add(`${key.channel}AlreadyHandled`);
    return;
  }
  let delivery: Delivery;
  try {
    delivery = await send();
  } catch (e) {
    delivery = { status: "failed", error: e instanceof Error ? e.name : "unknown" };
  }
  await finishReminder(deps.db, key, { ...delivery, now: deps.now() });
  counter.add(`${key.channel}${delivery.status[0].toUpperCase()}${delivery.status.slice(1)}`);
}

export async function runRenewalReminders(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const counter = new Counter("renewal-reminders");
  const candidates = await reminderCandidates(
    deps.db,
    now,
    new Date(now.getTime() + REMINDER_LEAD_DAYS * DAY_MS),
    new Date(now.getTime() + DAY_MS),
    deps.batchSize ?? BATCH,
  );
  counter.add("candidates", candidates.length);

  await counter.each(candidates, (c) => c.subscriptionId, async (candidate) => {
    const reminder = reminderDue(candidate.periodEnd, now);
    if (!reminder) return;
    counter.add(`due${reminder}`);
    const recipients = await reminderRecipients(deps.db, candidate);
    const base = { subscriptionId: candidate.subscriptionId, periodEnd: candidate.periodEnd, reminder };
    await deliver(deps, { ...base, channel: "email" }, counter, () => sendEmails(deps, candidate, reminder, recipients));
    await deliver(deps, { ...base, channel: "sms" }, counter, () => sendSms(deps, candidate, recipients));
  });
  return { status: "ok", counts: counter.counts };
}
