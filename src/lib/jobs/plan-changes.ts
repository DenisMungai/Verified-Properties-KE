import "server-only";
import { dueDowngradeIds, lockPoolActiveListings } from "@/db/queries/jobs";
import { getPlan, lockSubscription, ownerOf, recordPaymentEvent, updateSubscription } from "@/db/queries/payments";
import { DAY_MS, GRACE_DAYS } from "@/lib/billing/constants";
import { pickListingsToKeep } from "@/lib/billing/entitlements";
import { applyKeepSelection } from "@/lib/billing/plan-schedule";
import { Counter } from "./counter";
import type { JobDeps, JobResult } from "./types";

/**
 * Downgrades in force (prompt S6 decisions 3–4; S9 decision 6). The lister has 3 days from the
 * change date to choose which listings stay live; after that the newest stay and the rest are
 * taken out exactly as their own choice would. Only then is the scheduled plan written into
 * `plan_id`: until the deadline the billing page needs `scheduled_change_at` to show it, and the
 * effective-plan rule already keeps entitlement correct.
 */

const BATCH = 100;

/** How long the lister has to choose after the change date (the same 3 days as grace). */
export const CHOOSE_WINDOW_MS = GRACE_DAYS * DAY_MS;

type Outcome = { kind: "skipped" } | { kind: "applied"; autoPicked: boolean; paused: number; toDraft: number };

async function applyOne(deps: JobDeps, id: string, now: Date): Promise<Outcome> {
  const deadline = now.getTime() - CHOOSE_WINDOW_MS;
  return deps.withTransaction(async (tx) => {
    const sub = await lockSubscription(tx, id);
    if (!sub?.scheduledPlanId || !sub.scheduledChangeAt || sub.scheduledChangeAt.getTime() > deadline) return { kind: "skipped" };
    const plan = await getPlan(tx, sub.scheduledPlanId);
    if (!plan || plan.listingLimit === null) return { kind: "skipped" };

    const active = await lockPoolActiveListings(tx, ownerOf(sub));
    let taken = { paused: 0, toDraft: 0 };
    const autoPicked = active.length > plan.listingLimit;
    if (autoPicked) {
      const keep = new Set(pickListingsToKeep(active, plan.listingLimit).map((row) => row.id));
      taken = await applyKeepSelection(tx, active, keep, now);
    }

    await updateSubscription(tx, sub.id, { planId: plan.id, scheduledPlanId: null, scheduledChangeAt: null });
    await recordPaymentEvent(tx, {
      eventType: "status_change",
      payload: {
        entity: "subscription",
        subscriptionId: sub.id,
        action: "downgrade_applied",
        planFrom: sub.planId,
        planTo: plan.id,
        autoKept: autoPicked ? plan.listingLimit : 0,
        paused: taken.paused,
        toDraft: taken.toDraft,
      },
    });
    console.info(
      `[jobs] plan-changes subscription=${sub.id} autoPicked=${autoPicked} paused=${taken.paused} draft=${taken.toDraft}`,
    );
    return { kind: "applied", autoPicked, ...taken };
  });
}

export async function runPlanChanges(deps: JobDeps): Promise<JobResult> {
  const now = deps.now();
  const counter = new Counter("plan-changes");
  const ids = await dueDowngradeIds(deps.db, new Date(now.getTime() - CHOOSE_WINDOW_MS), deps.batchSize ?? BATCH);
  counter.add("candidates", ids.length);
  await counter.each(ids, (id) => id, async (id) => {
    const outcome = await applyOne(deps, id, now);
    if (outcome.kind === "skipped") {
      counter.add("skipped");
      return;
    }
    counter.add("applied");
    if (outcome.autoPicked) counter.add("autoPicked");
    counter.add("pausedListings", outcome.paused);
    counter.add("listingsToDraft", outcome.toDraft);
  });
  return { status: "ok", counts: counter.counts };
}
