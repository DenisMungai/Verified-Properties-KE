import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeading } from "@/components/account/PageHeading";
import { CurrentPlanCard } from "@/components/billing/CurrentPlanCard";
import { InvoiceTable } from "@/components/billing/InvoiceTable";
import { KeepListingsForm } from "@/components/billing/KeepListingsForm";
import { PaybillInstructions } from "@/components/billing/PaybillInstructions";
import { VerificationCard } from "@/components/billing/VerificationCard";
import { FormAlert } from "@/components/forms/FormAlert";
import { Button, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { getBillingOverview, listInvoices, type BillingOverview } from "@/db/queries/billing-page";
import type { ActionState } from "@/lib/action-state";
import { DAY_MS, GRACE_DAYS } from "@/lib/billing/constants";
import { listingsUsingSlots } from "@/lib/billing/plan-schedule";
import { formatNairobiDate } from "@/lib/format";
import { getMpesaSettings } from "@/lib/mpesa";
import { single, type SearchParams } from "@/lib/search-params";
import { requireLister } from "../listings/guard";
import { cancelScheduledChangeAction } from "./actions";

export const metadata: Metadata = { title: "Subscription & billing" };

const FLASH: Record<string, ActionState> = {
  scheduled: { message: "Your plan change is scheduled. Nothing to pay now." },
  cancelled: { message: "Scheduled change cancelled. You keep your current plan." },
  kept: { message: "Saved. The listings you chose stay live; the rest are paused until you have room again." },
  cancel_failed: { formError: "We couldn't cancel the change. Please try again." },
};

/** A downgrade waiting for its date (prompt S6 decision 4, before the change). */
function ScheduledNotice({ overview }: { overview: BillingOverview }) {
  const { scheduledPlan, subscription, plan, canManage } = overview;
  if (!scheduledPlan || !subscription?.scheduledChangeAt || !plan) return null;
  const date = formatNairobiDate(subscription.scheduledChangeAt);
  return (
    <section aria-labelledby="scheduled-heading" className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4 md:p-5">
      <h2 id="scheduled-heading" className="text-title">
        {scheduledPlan.name} starts on {date}
      </h2>
      <p className="text-small text-slate-700">
        From {date} you can keep {scheduledPlan.listingLimit} listings live. You&rsquo;ll choose which ones then; until
        then all of them stay live.
      </p>
      {canManage && (
        <form action={cancelScheduledChangeAction}>
          <Button type="submit" variant="secondary">
            Keep {plan.name}
          </Button>
        </form>
      )}
    </section>
  );
}

/** Over the limit after a downgrade took effect: choose which listings stay live (decision 4). */
async function KeepChoice({ overview, now }: { overview: BillingOverview; now: Date }) {
  const limit = overview.effectivePlan?.listingLimit ?? null;
  if (!overview.canManage || limit === null || overview.activeListingCount <= limit) return null;
  const rows = await listingsUsingSlots(getDb(), overview.pool);
  const changeAt = overview.subscription?.scheduledChangeAt;
  const deadline = changeAt && changeAt.getTime() <= now.getTime() ? new Date(changeAt.getTime() + GRACE_DAYS * DAY_MS) : null;
  return (
    <section aria-labelledby="keep-heading" className="flex flex-col gap-4 rounded-lg border border-warning bg-white p-4 md:p-5">
      <div className="flex flex-col gap-1">
        <h2 id="keep-heading" className="text-title">
          Choose which listings stay live
        </h2>
        <p className="text-small text-slate-700">
          Your {overview.effectivePlan?.name} plan allows {limit} live listings and you have {overview.activeListingCount}.
          The ones you don&rsquo;t keep are paused, or go back to draft if they&rsquo;re waiting for review.
          {deadline && ` If you don't choose by ${formatNairobiDate(deadline)}, we'll keep the newest ${limit}.`}
        </p>
      </div>
      <KeepListingsForm
        limit={limit}
        listings={rows.map((row) => ({
          id: row.id,
          title: row.title,
          location: row.neighbourhood ?? row.town,
          status: row.status === "pending_review" ? "pending_review" : "published",
        }))}
      />
    </section>
  );
}

async function Billing({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireLister("/account/billing"), searchParams]);
  const db = getDb();
  const now = new Date();
  const overview = await getBillingOverview(db, user.id, now);
  const invoices = await listInvoices(db, overview.pool);
  const flash = FLASH[single(params.updated) ?? single(params.error) ?? ""];
  const paybill = getMpesaSettings()?.shortcode ?? null;

  return (
    <div className="flex flex-col gap-6">
      {flash && <FormAlert state={flash} />}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <CurrentPlanCard overview={overview} now={now} />
        </div>
        <VerificationCard />
      </div>
      <ScheduledNotice overview={overview} />
      <KeepChoice overview={overview} now={now} />
      {overview.canManage && overview.openInvoice && paybill && (
        <PaybillInstructions
          title={`Pay invoice ${overview.openInvoice.invoiceNumber} by Paybill`}
          paybill={paybill}
          invoiceNumber={overview.openInvoice.invoiceNumber}
          amountKes={overview.openInvoice.amountKes}
        />
      )}
      <InvoiceTable rows={invoices} showAmounts={overview.canManage} />
    </div>
  );
}

function BillingSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading your billing</span>
      <div className="grid gap-4 xl:grid-cols-3">
        <Skeleton className="h-72 rounded-lg xl:col-span-2" />
        <Skeleton className="h-72 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export default function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Subscription & billing" description="Manage your listing plan, renewals and payment history." />
      <Suspense fallback={<BillingSkeleton />}>
        <Billing searchParams={searchParams} />
      </Suspense>
    </>
  );
}
