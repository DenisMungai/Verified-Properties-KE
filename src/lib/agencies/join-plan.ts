import { pickListingsToKeep, remainingSlots } from "@/lib/billing/entitlements";
import { subscriptionPhase, type SubscriptionTiming } from "@/lib/billing/periods";

/**
 * What joining an agency does to a lister's listings and plan (prompt S23 decisions 5 and 6).
 * Pure: the warning shown before joining and the join transaction both use `planJoin`, so what
 * the lister is told is what happens.
 */

export interface LiveListing {
  id: string;
  status: "published" | "pending_review";
  publishedAt: Date | null;
}

export interface PersonalPlan {
  name: string;
  /** End of the paid period, or null for a plan that was never paid. */
  paidUntil: Date | null;
}

export interface JoinPlan {
  /** The joiner's live listings (published or in review). */
  liveCount: number;
  /** Places free in the agency's plan before the joiner's listings move in. */
  freeSlots: number;
  keepIds: string[];
  /** Published listings paused for the agency's limit. */
  pauseIds: string[];
  /** Listings in review that go back to draft (a paused listing would skip the review). */
  toDraftIds: string[];
  /** The joiner's own listing plan, cancelled without a refund. */
  cancelledPlan: PersonalPlan | null;
}

/**
 * Free places in the agency's plan: only an active plan takes new listings (as for publishing);
 * pending, grace, lapsed or no plan means none.
 */
export function agencyFreeSlots({
  subscription,
  listingLimit,
  activeListingCount,
  now,
}: {
  subscription: SubscriptionTiming | null;
  listingLimit: number | null;
  activeListingCount: number;
  now: Date;
}): number {
  if (!subscription || listingLimit === null) return 0;
  if (subscriptionPhase(subscription, now) !== "active") return 0;
  return remainingSlots(listingLimit, activeListingCount);
}

/** The agency's own live listings keep their places; the joiner's newest fill what is left. */
export function planJoin({
  joinerLive,
  freeSlots,
  personalPlan,
}: {
  joinerLive: readonly LiveListing[];
  freeSlots: number;
  personalPlan: PersonalPlan | null;
}): JoinPlan {
  const keep = new Set(pickListingsToKeep(joinerLive, freeSlots).map((l) => l.id));
  const leaving = joinerLive.filter((l) => !keep.has(l.id));
  return {
    liveCount: joinerLive.length,
    freeSlots,
    keepIds: [...keep],
    pauseIds: leaving.filter((l) => l.status === "published").map((l) => l.id),
    toDraftIds: leaving.filter((l) => l.status === "pending_review").map((l) => l.id),
    cancelledPlan: personalPlan,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The warning shown before joining or creating, one sentence per line. `formatDate` is injected so
 * this stays pure and testable (pages pass the Nairobi date formatter).
 */
export function joinWarning(
  plan: JoinPlan,
  { agencyName, creating, formatDate }: { agencyName: string; creating: boolean; formatDate: (date: Date) => string },
): string[] {
  const lines: string[] = [];
  const target = creating ? "your new agency" : agencyName;

  if (plan.liveCount === 0) {
    lines.push(`Your listings will move to ${target} and use its listing plan.`);
  } else {
    lines.push(
      `You have ${plural(plan.liveCount, "live listing")}. They will move to ${target} and use its listing plan` +
        (creating ? ", which you'll pay for as the agency's admin." : ` (${plural(plan.freeSlots, "place")} free).`),
    );
    const paused = plan.pauseIds.length;
    const drafted = plan.toDraftIds.length;
    if (paused + drafted === 0) {
      lines.push("All of them stay live.");
    } else {
      const parts = [
        paused > 0 && `${plural(paused, "listing")} will be paused`,
        drafted > 0 && `${plural(drafted, "listing")} waiting for review will go back to draft`,
      ].filter(Boolean);
      lines.push(
        `${parts.join(" and ")}${creating ? " until the agency's plan is paid" : " because the agency's plan has no room for them"}.`,
      );
    }
  }

  if (plan.cancelledPlan) {
    const until = plan.cancelledPlan.paidUntil ? `, paid until ${formatDate(plan.cancelledPlan.paidUntil)},` : "";
    lines.push(`Your own ${plan.cancelledPlan.name} plan${until} ends today. It isn't refunded.`);
  }
  lines.push("Your verification is not affected.");
  return lines;
}
