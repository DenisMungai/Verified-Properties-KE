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
import { paidAmountCovering, type Plan } from "@/db/queries/payments";
import { getVerificationSubscription } from "@/db/queries/verification";
import { checkoutOption } from "@/lib/billing/plan-change";
import { planFitsPool, planTerms } from "@/lib/billing/prepare-invoice";
import { cardPaymentsEnabled } from "@/lib/card";
import { formatNairobiDate } from "@/lib/format";
import { getMpesaSettings } from "@/lib/mpesa";
import { single, type SearchParams } from "@/lib/search-params";
import { checkVerificationPurchase, VERIFICATION_PURCHASE_MESSAGES } from "@/lib/verification/purchase";
import { requireLister } from "../../listings/guard";

export const metadata: Metadata = { title: "Choose a plan" };

/** "+254712345678" -> "0712 345 678" for the phone field. */
function localPhone(e164: string | null | undefined): string {
  const match = e164 ? /^\+254(\d{3})(\d{3})(\d{3})$/.exec(e164) : null;
  return match ? `0${match[1]} ${match[2]} ${match[3]}` : "";
}

/**
 * `?plan=verification` (prompt S12 decision 4): the verification add-on on its own. Paying opens
 * a review; the server re-checks eligibility and prices it from `plans` when the payment starts.
 */
async function VerificationCheckout({ userId, plan, phone }: { userId: string; plan: Plan; phone: string }) {
  const db = getDb();
  const now = new Date();
  const eligible = await checkVerificationPurchase(db, userId, now);
  if (!eligible.ok) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert state={{ formError: VERIFICATION_PURCHASE_MESSAGES[eligible.code] }} />
        <Link href="/account/verification" className={buttonClasses({ variant: "secondary", className: "self-start" })}>
          Back to verification
        </Link>
      </div>
    );
  }
  const mpesa = getMpesaSettings();
  const cardsEnabled = cardPaymentsEnabled();
  if (!mpesa && !cardsEnabled) {
    return <FormAlert state={{ formError: "Payments are not set up yet. Please try again later." }} />;
  }
  const live = await getVerificationSubscription(db, userId);
  const current = live ? { subscription: live.subscription, plan: planTerms(live.plan) } : null;
  const option: CheckoutPlanOption = {
    code: plan.code,
    name: plan.name,
    listingLimit: null,
    summary: "Admin review of your documents, then the \"Profile verified\" badge while it's paid",
    ...checkoutOption({ current, target: planTerms(plan), now, coveringPaidAmountKes: null }),
  };
  return (
    <div className="flex flex-col gap-6">
      <FormAlert state={{ message: "Paying starts your review. The badge appears only after an admin approves your documents." }} />
      <CheckoutForm
        options={[option]}
        defaultCode={option.code}
        defaultPhone={phone}
        mpesaEnabled={mpesa !== null}
        cardsEnabled={cardsEnabled}
        paybill={mpesa?.shortcode ?? null}
      />
      <Link href="/account/verification" className="inline-flex min-h-control items-center self-start text-small font-medium text-emerald-700 underline underline-offset-4 hover:text-ink">
        What verification checks
      </Link>
    </div>
  );
}

async function Checkout({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireLister("/account/billing/checkout"), searchParams]);
  const db = getDb();
  const now = new Date();
  const requestedCode = single(params.plan);
  if (requestedCode) {
    const verification = (await getActivePlans(db, "verification")).find((plan) => plan.code === requestedCode);
    if (verification) {
      const profile = await getListerProfile(db, user.id);
      return <VerificationCheckout userId={user.id} plan={verification} phone={localPhone(profile?.phone)} />;
    }
  }
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
      <Link href="/pricing" className="inline-flex min-h-control items-center self-start text-small font-medium text-emerald-700 underline underline-offset-4 hover:text-ink">
        Compare plans
      </Link>
    </div>
  );
}

function CheckoutSkeleton() {
  return (
    <div className="flex flex-col gap-6 rounded-lg border border-line bg-white p-5" aria-busy="true">
      <span className="sr-only">Loading plans</span>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Skeleton className="h-40 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
      <Skeleton className="h-control w-full max-w-sm" />
      <Skeleton className="h-control-lg w-56" />
    </div>
  );
}

const BACK_TO_BILLING = (
  <Link href="/account/billing" className={buttonClasses({ variant: "secondary", className: "self-start" })}>
    Back to billing
  </Link>
);

const LISTING_HEADING = (
  <PageHeading
    title="Choose a plan"
    description="Pick the plan that fits how many listings you want live. Drafts stay free."
    action={BACK_TO_BILLING}
  />
);

/** The verification add-on gets its own heading; everything else is the plan picker. */
async function CheckoutHeading({ searchParams }: { searchParams: SearchParams }) {
  const requested = single((await searchParams).plan);
  const isVerification = requested ? (await getActivePlans(getDb(), "verification")).some((plan) => plan.code === requested) : false;
  if (!isVerification) return LISTING_HEADING;
  return (
    <PageHeading
      title="Pay for verification"
      description="Paying starts your review. You upload your documents next."
      action={BACK_TO_BILLING}
    />
  );
}

export default function CheckoutPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <Suspense fallback={LISTING_HEADING}>
        <CheckoutHeading searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<CheckoutSkeleton />}>
        <Checkout searchParams={searchParams} />
      </Suspense>
    </>
  );
}
