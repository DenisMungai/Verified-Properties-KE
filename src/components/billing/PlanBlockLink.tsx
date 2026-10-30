import Link from "next/link";
import { buttonClasses } from "@/components/ui";
import type { PublishBlockReason } from "@/lib/billing/entitlements";
import { checkoutPath } from "@/lib/billing/receipt-path";

/**
 * The next step when publishing is blocked for a plan reason (prompt S6 decision 9). A visible
 * link instead of a redirect, so the lister keeps their place.
 */
export function planBlockLink(reason: PublishBlockReason, currentPlanCode?: string): { label: string; href: string } {
  switch (reason) {
    case "no_plan":
      return { label: "Choose a plan", href: checkoutPath() };
    case "plan_in_grace":
    case "plan_lapsed":
      return { label: "Renew plan", href: checkoutPath(currentPlanCode) };
    case "limit_reached":
      return { label: "Upgrade plan", href: checkoutPath() };
    case "plan_pending":
      return { label: "View billing", href: "/account/billing" };
  }
}

export function PlanBlockLink({
  reason,
  currentPlanCode,
  className,
}: {
  reason: PublishBlockReason;
  currentPlanCode?: string;
  className?: string;
}) {
  const { label, href } = planBlockLink(reason, currentPlanCode);
  return (
    <Link href={href} className={buttonClasses({ variant: "secondary", className })}>
      {label}
    </Link>
  );
}

export const PUBLISH_BLOCK_REASONS: readonly PublishBlockReason[] = [
  "no_plan",
  "plan_pending",
  "plan_in_grace",
  "plan_lapsed",
  "limit_reached",
];

export function isPublishBlockReason(value: string | undefined): value is PublishBlockReason {
  return value !== undefined && (PUBLISH_BLOCK_REASONS as readonly string[]).includes(value);
}
