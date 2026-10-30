import { Badge, type BadgeTone } from "@/components/ui";
import { DAY_MS } from "@/lib/billing/constants";
import type { SubscriptionPhase } from "@/lib/billing/periods";

/** "Renew soon" from this many days before the period end (matches the S9 reminder). */
const RENEW_SOON_DAYS = 5;

export function planStatus(
  phase: SubscriptionPhase,
  periodEnd: Date | null,
  now: Date,
): { label: string; tone: BadgeTone } {
  switch (phase) {
    case "pending":
      return { label: "Payment pending", tone: "warning" };
    case "grace":
      return { label: "In grace", tone: "warning" };
    case "lapsed":
      return { label: "Expired", tone: "danger" };
    case "active":
      return periodEnd && periodEnd.getTime() - now.getTime() <= RENEW_SOON_DAYS * DAY_MS
        ? { label: "Renew soon", tone: "warning" }
        : { label: "Active", tone: "success" };
  }
}

export function PlanStatusBadge({ phase, periodEnd, now }: { phase: SubscriptionPhase; periodEnd: Date | null; now: Date }) {
  const { label, tone } = planStatus(phase, periodEnd, now);
  return <Badge tone={tone}>{label}</Badge>;
}
