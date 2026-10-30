import "server-only";
import { lapsingSubscriptionIds } from "@/db/queries/jobs";
import { lockSubscription, ownerOf, pausePoolListings, recordPaymentEvent, updateSubscription } from "@/db/queries/payments";
import { PAID_SUBSCRIPTION_STATUSES, type SubscriptionStatus } from "@/lib/billing/constants";
import { Counter } from "./counter";
import type { JobDeps, JobResult } from "./types";

/**
 * Grace expiry (plan v2.0 §4 "When a subscription lapses"; prompt S9 decision 5). After
 * `grace_ends_at` a paid subscription moves to `paused`, a live status that keeps the owner's
 * slot so renewal confirms onto the same row. A listing plan's published listings are paused
 * (`plan_lapsed`) and leave search; `confirmPayment` restores them on renewal. The badge needs no
 * write: `verified_listers_now` already dropped it at `grace_ends_at`.
 */

const BATCH = 100;

type Outcome = { kind: "skipped" } | { kind: "paused"; planKind: "listing" | "verification"; listings: number };

async function expireOne(deps: JobDeps, id: string, now: Date): Promise<Outcome> {
  return deps.withTransaction(async (tx) => {
    const sub = await lockSubscription(tx, id);
    const stillLapsing =
      sub !== null &&
      (PAID_SUBSCRIPTION_STATUSES as readonly SubscriptionStatus[]).includes(sub.status) &&
      sub.graceEndsAt !== null &&
      sub.graceEndsAt.getTime() <= now.getTime();
    // Renewed (or changed) between the candidate read and the lock.
    if (!sub || !stillLapsing) return { kind: "skipped" };

    await updateSubscription(tx, sub.id, { status: "paused" });
    const paused = sub.kind === "listing" ? await pausePoolListings(tx, ownerOf(sub), now) : [];
    await recordPaymentEvent(tx, {
      eventType: "status_change",
      payload: {
        entity: "subscription",
        subscriptionId: sub.id,
        from: sub.status,
        to: "paused",
        action: "grace_expired",
        pausedListings: paused.length,
      },
    });
    console.info(`[jobs] grace-expiry subscription=${sub.id} kind=${sub.kind} pausedListings=${paused.length}`);
    return { kind: "paused", planKind: sub.kind, listings: paused.length };
  });
}

export async function runGraceExpiry(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const counter = new Counter("grace-expiry");
  const ids = await lapsingSubscriptionIds(deps.db, now, deps.batchSize ?? BATCH);
  counter.add("candidates", ids.length);
  await counter.each(ids, (id) => id, async (id) => {
    const outcome = await expireOne(deps, id, now);
    if (outcome.kind === "skipped") {
      counter.add("skipped");
      return;
    }
    counter.add(outcome.planKind === "listing" ? "pausedListingPlans" : "pausedVerificationPlans");
    counter.add("pausedListings", outcome.listings);
  });
  return { status: "ok", counts: counter.counts };
}
