import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Heart, Phone, Plus, UserRound } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { FormAlert } from "@/components/forms/FormAlert";
import { planUsageSummary } from "@/components/listings/PlanUsagePanel";
import { Badge, EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { getListingPlanUsage, type ListingPlanUsage } from "@/db/queries/billing";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { remainingSlots } from "@/lib/billing/entitlements";
import { firstName } from "@/lib/email/templates";
import { greetingFor } from "@/lib/greeting";
import { displayKenyanPhone } from "@/lib/kenya";
import { LISTER_ROLES, LISTER_TYPE_LABELS, hasAnyRole } from "@/lib/roles";
import { requireUser } from "@/lib/session";
import type { SearchParams } from "@/lib/search-params";

export const metadata: Metadata = { title: "Your account" };

/** Design "01 — Lister Dashboard" stat card. Other cards (enquiries, views) arrive with their data. */
function ActiveListingsCard({ usage }: { usage: ListingPlanUsage }) {
  const { headline, detail } = planUsageSummary(usage);
  const hasPlan = usage.limit !== null;
  return (
    <section aria-labelledby="active-listings-heading" className="flex flex-col gap-2 rounded-lg border border-line bg-white p-5">
      <h2 id="active-listings-heading" className="text-small font-medium text-slate-700">
        Active listings
      </h2>
      <p className="text-display-sm tabular">
        {hasPlan ? `${usage.activeListingCount} / ${usage.limit}` : usage.activeListingCount}
      </p>
      <p className="text-small text-emerald-700">
        {hasPlan && usage.phase === "active"
          ? `${remainingSlots(usage.limit ?? 0, usage.activeListingCount)} slots available`
          : detail || headline}
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <Link href="/account/listings" className="inline-flex min-h-control items-center text-small font-medium text-emerald-700 underline underline-offset-4 hover:text-ink">
          View my listings
        </Link>
        <Link
          href={hasPlan ? "/account/billing" : "/account/billing/checkout"}
          className="inline-flex min-h-control items-center text-small font-medium text-emerald-700 underline underline-offset-4 hover:text-ink"
        >
          {hasPlan ? "Manage plan" : "Choose a plan"}
        </Link>
      </div>
    </section>
  );
}

async function Overview({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireUser(), searchParams]);
  const profile = await getListerProfile(getDb(), user.id);
  const isLister = hasAnyRole(user.roles, LISTER_ROLES);
  const usage = isLister && profile ? await getListingPlanUsage(getDb(), user.id) : null;

  return (
    <>
      <PageHeading
        title={`${greetingFor(new Date())}, ${firstName(user.name)}`}
        description={
          isLister ? "Your listings, profile and account at a glance." : "Your saved homes and account at a glance."
        }
        action={
          usage ? (
            <Link href="/account/listings/new" className={buttonClasses({ size: "lg", className: "self-start" })}>
              <Plus aria-hidden="true" className="size-4" />
              Add a property
            </Link>
          ) : undefined
        }
      />
      {params.welcome === "lister" && (
        <FormAlert
          className="mb-6"
          state={{ message: "Your listing profile is ready. Add your first property whenever you like." }}
        />
      )}
      {usage && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <ActiveListingsCard usage={usage} />
        </div>
      )}
      <div className="grid gap-4 xl:grid-cols-2">
        {profile ? (
          <section aria-labelledby="profile-heading" className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex flex-col gap-1">
                <h2 id="profile-heading" className="text-title">
                  {profile.displayName}
                </h2>
                <p className="text-small text-slate-600">{LISTER_TYPE_LABELS[profile.listerType]}</p>
              </div>
              {/* The badge is derived from review + subscriptions (S2); nobody is verified yet. */}
              <Badge>Not verified</Badge>
            </div>
            {profile.phone && (
              <p className="flex items-center gap-2 text-small text-ink">
                <Phone aria-hidden="true" className="size-4 text-slate-600" />
                <span className="tabular">{displayKenyanPhone(profile.phone)}</span>
              </p>
            )}
            <Link href="/account/profile" className={buttonClasses({ variant: "secondary", className: "self-start" })}>
              Edit listing profile
            </Link>
          </section>
        ) : (
          <section aria-labelledby="start-listing-heading" className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
            <span aria-hidden="true" className="inline-flex size-10 items-center justify-center rounded-full bg-mint-50 text-emerald-700">
              <UserRound className="size-5" />
            </span>
            <h2 id="start-listing-heading" className="text-title">
              {isLister ? "Finish your listing profile" : "Want to list property?"}
            </h2>
            <p className="text-small text-slate-600">
              Tell buyers who you are and how to reach you. You can list as an agent, a private owner or a developer.
            </p>
            <Link href="/account/onboarding" className={buttonClasses({ variant: "quiet", className: "self-start" })}>
              Set up a listing profile
            </Link>
          </section>
        )}
        <EmptyState
          icon={<Heart />}
          title="Saved homes will appear here"
          description="Tap the heart on any listing to keep it on your shortlist."
          action={
            <Link href="/" className={buttonClasses({ variant: "secondary" })}>
              Explore properties
            </Link>
          }
        />
      </div>
    </>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading your account</span>
      <Skeleton className="h-10 w-80 max-w-full" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-48" />
        <Skeleton className="h-48" />
      </div>
    </div>
  );
}

export default function AccountOverviewPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <Suspense fallback={<OverviewSkeleton />}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}
