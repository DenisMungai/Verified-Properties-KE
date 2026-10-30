import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PageHeading } from "@/components/account/PageHeading";
import { CheckoutForm, type CheckoutPlanOption } from "@/components/billing/CheckoutForm";
import { FormAlert } from "@/components/forms/FormAlert";
import { Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { getActivePlans } from "@/db/queries/billing";
import { getBillingOverview } from "@/db/queries/billing-page";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { paidAmountCovering } from "@/db/queries/payments";
import { checkoutOption } from "@/lib/billing/plan-change";
import { planFitsPool, planTerms } from "@/lib/billing/prepare-invoice";
import { cardPaymentsEnabled } from "@/lib/card";
import { formatNairobiDate } from "@/lib/format";
import { getMpesaSettings } from "@/lib/mpesa";
import { single, type SearchParams } from "@/lib/search-params";
import { requireLister } from "../../listings/guard";

export const metadata: Metadata = { title: "Choose a plan" };

/** "+254712345678" -> "0712 345 678" for the phone field. */
function localPhone(e164: string | null | undefined): string {
  const match = e164 ? /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164) : null;
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : "";
}

async function Checkout({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireLister("/account/billing/checkout"), searchParams]);
  const db = getDb();
  const now = new Date();
  const [overview, plans, profile] = await Promise.all([
    getBillingOverview(db, user.id, now),
    getActivePlans(db, "listing"),
    getListerProfile(db, user.id),
  ]);

  if (!overview.canManage) {
    return (
      <FormAlert state={{ formError: "Your agency's plan is paid by an agency admin. Ask them to renew or change it." }} />
    );
  }

  const mpesa = getMpesaSettings();
  const cardsEnabled = cardPaymentsEnabled();
  if (!mpesa && !cardsEnabled) {
    return <FormAlert state={{ formError: "Payments are not set up yet. Please try again later." }} />;
  }

  const { subscription, plan } = overview;
  const current = subscription && plan ? { subscription, plan: planTerms(plan) } : null;
  const covering = subscription ? await paidAmountCovering(db, subscription.id, now) : null;
  const eligible = plans.filter((candidate) => planFitsPool(candidate, overview.pool));
  if (eligible.length === 0) {
    return <FormAlert state={{ formError: "No plans are available right now. Please try again later." }} />;
  }
  const options: CheckoutPlanOption[] = eligible.map((candidate) => ({
    code: candidate.code,
    name: candidate.name,
    listingLimit: candidate.listingLimit,
    ...checkoutOption({ current, target: planTerms(candidate), now, coveringPaidAmountKes: covering }),
  }));

  const requested = single(params.plan);
  const defaultCode =
    options.find((option) => option.code === requested)?.code ??
    options.find((option) => option.isCurrent)?.code ??
    options[0].code;

  return (
    <div className="flex flex-col gap-6">
      {overview.scheduledPlan && subscription?.scheduledChangeAt && plan && (
        <FormAlert
          state={{
            message: `${overview.scheduledPlan.name} starts on ${formatNairobiDate(subscription.scheduledChangeAt)}. Renewing ${plan.name} instead cancels that change.`,
          }}
        />
      )}
      <CheckoutForm
        options={options}
        defaultCode={defaultCode}
        defaultPhone={localPhone(profile?.phone)}
        mpesaEnabled={mpesa !== null}
        cardsEnabled={cardsEnabled}
        paybill={mpesa?.shortcode ?? null}
      />
      <Link href="/pricing" className="inline-flex min-h-control items-center self-start text-body-sm font-medium text-emerald-700 underline underline-offset-2 hover:text-ink">
        Compare plans
      </Link>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="flex flex-col gap-6 rounded-xl border border-line bg-white p-6" aria-busy="true">
      <span className="sr-only">Loading plans</span>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
      <Skeleton className="h-control w-full max-w-sm" />
      <Skeleton className="h-control-lg w-56" />
    </div>
  );
}

export default function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading
        title="Choose a plan"
        description="Pick the plan that fits how many listings you want live. Drafts stay free."
        action={
          <Link href="/account/billing" className={buttonClasses({ variant: "secondary", className: "self-start" })}>
            Back to billing
          </Link>
        }
      />
      <Suspense fallback={<CheckoutSkeleton />}>
        <Checkout searchParams={searchParams} />
      </Suspense>
    </>
  );
}
