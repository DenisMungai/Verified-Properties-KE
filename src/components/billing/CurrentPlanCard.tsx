import Link from "next/link";
import { buttonClasses } from "@/components/ui";
import type { BillingOverview } from "@/db/queries/billing-page";
import { checkoutPath } from "@/lib/billing/receipt-path";
import { formatNairobiDate } from "@/lib/format";
import { listingLimitLine } from "./plan-copy";
import { PlanStatusBadge } from "./PlanStatusBadge";

function UsageBar({ used, limit }: { used: number; limit: number }) {
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small text-slate-700 tabular">
        {used} of {limit} active listings used
      </p>
      <div
        role="progressbar"
        aria-label="Active listings used"
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-valuenow={Math.min(used, limit)}
        className="h-2 overflow-hidden rounded-full bg-line"
      >
        <div className="h-full rounded-full bg-emerald-600" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function renewalLine(overview: BillingOverview): string {
  const end = overview.subscription?.currentPeriodEnd;
  if (overview.phase === "pending" || !end) return "Awaiting payment";
  if (overview.phase === "lapsed") return `Expired on ${formatNairobiDate(end)}`;
  if (overview.phase === "grace") return `Ended on ${formatNairobiDate(end)}. Renew to keep your listings live.`;
  return `Renewal date: ${formatNairobiDate(end)}`;
}

/** Design "02 — Billing & Verification": current listing plan with status, usage and actions. */
export function CurrentPlanCard({ overview, now }: { overview: BillingOverview; now: Date }) {
  const { plan, effectivePlan, subscription, phase, canManage } = overview;
  const shown = effectivePlan ?? plan;

  if (!subscription || !shown || !phase) {
    return (
      <section aria-labelledby="current-plan-heading" className="flex flex-col gap-4 rounded-lg border border-line bg-white p-4 md:p-5">
        <p className="text-micro font-semibold uppercase tracking-wider text-slate-600">Current listing plan</p>
        <h2 id="current-plan-heading" className="text-title">
          No listing plan yet
        </h2>
        <p className="text-body text-slate-600">Drafts are free; you&rsquo;ll need a plan to publish.</p>
        {canManage ? (
          <Link href={checkoutPath()} className={buttonClasses({ size: "lg", className: "w-full sm:w-auto sm:self-start" })}>
            Choose a plan
          </Link>
        ) : (
          <p className="text-small text-slate-700">Your agency admin manages this plan.</p>
        )}
      </section>
    );
  }

  // Renew charges the scheduled plan when a downgrade is waiting (prompt S6 decision 3).
  const renewCode = overview.scheduledPlan?.code ?? plan?.code;
  return (
    <section aria-labelledby="current-plan-heading" className="flex flex-col gap-6 rounded-lg border border-line bg-white p-4 md:p-5">
      <div className="flex flex-col gap-2">
        <p className="text-micro font-semibold uppercase tracking-wider text-slate-600">Current listing plan</p>
        <h2 id="current-plan-heading" className="text-title">
          {shown.name}
        </h2>
        <p className="text-body text-slate-600">{listingLimitLine(shown.listingLimit)}</p>
      </div>
      <p className="text-body font-medium text-ink">{renewalLine(overview)}</p>
      {shown.listingLimit !== null && <UsageBar used={overview.activeListingCount} limit={shown.listingLimit} />}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="self-start sm:self-auto">
          <PlanStatusBadge phase={phase} periodEnd={subscription.currentPeriodEnd} now={now} />
        </div>
        {canManage ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            {phase !== "pending" && renewCode && (
              <Link href={checkoutPath(renewCode)} className={buttonClasses({ variant: "secondary", size: "lg", className: "w-full sm:w-auto" })}>
                Renew
              </Link>
            )}
            <Link
              href={phase === "pending" ? checkoutPath(plan?.code) : checkoutPath()}
              className={buttonClasses({ size: "lg", className: "w-full sm:w-auto" })}
            >
              {phase === "pending" ? "Pay now" : "Change plan"}
            </Link>
          </div>
        ) : (
          <p className="text-small text-slate-700">Your agency admin manages this plan.</p>
        )}
      </div>
    </section>
  );
}
