import { subscriptionPhase, type SubscriptionTiming } from "./periods";

/**
 * Listing entitlements (plan v2.0 §4, §9). Pure; the server loads the subscription and counts
 * active listings (src/db/queries/billing.ts), then asks here. Publishing and un-pausing both
 * need a paid-up plan with a free slot. Grace keeps live listings up but allows nothing new.
 */

export type PublishBlockReason = "no_plan" | "plan_pending" | "plan_in_grace" | "plan_lapsed" | "limit_reached";

export type PublishEntitlement =
  | { ok: true; limit: number; activeListingCount: number; remaining: number }
  | { ok: false; reason: PublishBlockReason; limit: number | null; activeListingCount: number };

export const PUBLISH_BLOCK_MESSAGES: Record<PublishBlockReason, string> = {
  no_plan: "Choose a listing plan to publish your listings.",
  plan_pending: "Your plan payment hasn't been confirmed yet. You can publish once it is.",
  plan_in_grace: "Your plan has ended. Renew your plan to publish.",
  plan_lapsed: "Your plan has expired. Renew your plan to publish.",
  limit_reached: "You've reached your plan's limit of live listings. Upgrade your plan or unpublish a listing.",
};

export function remainingSlots(limit: number, activeListingCount: number): number {
  return Math.max(0, limit - activeListingCount);
}

/** Whether one more listing may go live (publish, submit for review or un-pause). */
export function canPublish({
  subscription,
  listingLimit,
  activeListingCount,
  now,
}: {
  subscription: SubscriptionTiming | null;
  listingLimit: number | null;
  activeListingCount: number;
  now: Date;
}): PublishEntitlement {
  const blocked = (reason: PublishBlockReason): PublishEntitlement => ({
    ok: false,
    reason,
    limit: listingLimit,
    activeListingCount,
  });

  if (!subscription || listingLimit === null) return blocked("no_plan");
  switch (subscriptionPhase(subscription, now)) {
    case "pending":
      return blocked("plan_pending");
    case "grace":
      return blocked("plan_in_grace");
    case "lapsed":
      return blocked("plan_lapsed");
    case "active":
      break;
  }
  const remaining = remainingSlots(listingLimit, activeListingCount);
  if (remaining === 0) return blocked("limit_reached");
  return { ok: true, limit: listingLimit, activeListingCount, remaining };
}

export interface KeepCandidate {
  id: string;
  publishedAt: Date | null;
}

/**
 * Which listings stay live when only `limit` may (plan §4: restore on renewal, downgrade without a
 * choice): newest published first; ties by id so the result is stable. Never-published listings
 * sort last.
 */
export function pickListingsToKeep<T extends KeepCandidate>(listings: readonly T[], limit: number): T[] {
  if (limit <= 0) return [];
  return [...listings]
    .sort((a, b) => {
      const at = a.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      const bt = b.publishedAt?.getTime() ?? Number.NEGATIVE_INFINITY;
      if (at !== bt) return bt > at ? 1 : -1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit);
}
