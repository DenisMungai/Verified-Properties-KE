import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { PlanCard } from "@/components/billing/PlanCard";
import { planTermsLine } from "@/components/billing/plan-copy";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { getActivePlans } from "@/db/queries/billing";
import { checkoutPath } from "@/lib/billing/receipt-path";
import { cardPaymentsEnabled } from "@/lib/card";
import { signInPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Listing plans for agents, owners and agencies. Drafts are free; pay monthly with M-Pesa when you publish.",
};

/**
 * Public plans (prompt S6 decision 8). Read at request time so a new plan version shows at once.
 * Prices and limits come from the database; the CTA returns to the checkout after sign-in.
 */
async function Plans() {
  const [plans, user] = await Promise.all([getActivePlans(getDb(), "listing"), getCurrentUser()]);
  const visible = plans.filter((plan) => plan.priceKes > 0);
  const terms = planTermsLine(cardPaymentsEnabled());

  if (visible.length === 0) {
    return <p className="text-body text-slate-600">Plans will be listed here soon.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {visible.map((plan) => {
        const destination = checkoutPath(plan.code);
        const href = user?.emailVerified ? destination : signInPath(destination);
        return (
          <PlanCard
            key={plan.id}
            code={plan.code}
            name={plan.name}
            priceKes={plan.priceKes}
            listingLimit={plan.listingLimit}
            terms={terms}
            highlighted={plan.code === "pro"}
            action={
              <Link href={href} className={buttonClasses({ size: "lg", variant: plan.code === "pro" ? "primary" : "secondary", className: "w-full" })}>
                Choose {plan.name}
              </Link>
            }
          />
        );
      })}
    </div>
  );
}

function PlansSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      <span className="sr-only">Loading plans</span>
      {Array.from({ length: 3 }, (_, i) => (
        <Skeleton key={i} className="h-96 rounded-lg" />
      ))}
    </div>
  );
}

export default function PricingPage() {
  return (
    <PageContainer className="flex flex-col gap-8 pb-8 pt-6">
      <div className="flex max-w-prose flex-col gap-3">
        <h1 className="text-display-sm">Listing plans</h1>
        <p className="text-body text-slate-600">Drafts are free. Choose a plan when you&rsquo;re ready to publish.</p>
      </div>
      <Suspense fallback={<PlansSkeleton />}>
        <Plans />
      </Suspense>
      <section aria-labelledby="verification-addon-heading" className="flex flex-col gap-3 rounded-lg bg-mint-50 p-4 md:p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="verification-addon-heading" className="text-title text-emerald-700">
            Verification add-on
          </h2>
          <Badge>Coming soon</Badge>
        </div>
        <p className="max-w-prose text-small text-ink">
          A monthly add-on on top of any plan. After an admin review passes, your listings show &ldquo;Profile
          verified&rdquo;. Paying alone never makes anyone verified.
        </p>
      </section>
    </PageContainer>
  );
}
