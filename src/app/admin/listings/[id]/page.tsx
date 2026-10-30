import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { ApproveForm, RejectForm } from "@/components/admin/DecisionForms";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { ListingSummary } from "@/components/listings/ListingSummary";
import { Badge, Skeleton, type BadgeTone } from "@/components/ui";
import { getDb } from "@/db";
import { getListingForReview, moderationHistory } from "@/db/queries/moderation";
import type { SubscriptionPhase } from "@/lib/billing/periods";
import { formatNairobiDateTime } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Review listing", robots: { index: false } };

type Params = Promise<{ id: string }>;

const PLAN_LABELS: Record<SubscriptionPhase | "none", { label: string; tone: BadgeTone }> = {
  active: { label: "Plan active", tone: "success" },
  pending: { label: "Plan payment pending", tone: "warning" },
  grace: { label: "Plan in grace", tone: "warning" },
  lapsed: { label: "Plan lapsed", tone: "danger" },
  none: { label: "No plan", tone: "danger" },
};

const ACTION_LABELS: Record<string, string> = {
  approve: "Approved",
  reject: "Rejected",
  take_down: "Taken down",
  dismiss_report: "Report dismissed",
};

async function Review({ params }: { params: Params }) {
  await requireRole(["platform_admin"], "/admin/listings");
  const { id } = await params;
  await connection();
  const db = getDb();
  const review = await getListingForReview(db, id);
  if (!review) notFound();
  const history = await moderationHistory(db, id);
  const { listing, lister, photos, planPhase } = review;
  const plan = PLAN_LABELS[planPhase];
  const pending = listing.status === "pending_review";

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 rounded-xl border border-line bg-white p-5 md:p-6">
        <ListingSummary
          listing={listing}
          photos={photos.map((photo) => ({ baseUrl: publicImageBaseUrl(photo.storageKey), altText: photo.altText }))}
        />
      </div>
      <div className="flex flex-col gap-6">
        <section aria-labelledby="lister-heading" className="flex flex-col gap-2 rounded-xl border border-line bg-white p-5">
          <h2 id="lister-heading" className="text-h4">
            Lister
          </h2>
          <p className="text-body text-ink">{lister.agencyName ?? lister.displayName ?? lister.accountName}</p>
          {lister.agencyName && lister.displayName && <p className="text-body-sm text-slate-700">Listed by {lister.displayName}</p>}
          <p className="break-all text-body-sm text-slate-700">{lister.email}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            <ListingStatusBadge status={listing.status} />
            <Badge tone={plan.tone}>{plan.label}</Badge>
          </div>
        </section>

        <section aria-labelledby="decision-heading" className="flex flex-col gap-5 rounded-xl border border-line bg-white p-5">
          <h2 id="decision-heading" className="text-h4">
            Decision
          </h2>
          {pending ? (
            <>
              {planPhase !== "active" && (
                <p className="rounded-md bg-warning-tint px-4 py-3 text-body-sm text-warning-text">
                  The lister&apos;s plan isn&apos;t active, so approving will be refused until they pay. You can still reject.
                </p>
              )}
              <ApproveForm listingId={listing.id} />
              <div className="border-t border-line pt-5">
                <RejectForm listingId={listing.id} />
              </div>
            </>
          ) : (
            <p className="text-body-sm text-slate-700">This listing isn&apos;t waiting for review, so there&apos;s nothing to decide.</p>
          )}
        </section>

        <section aria-labelledby="history-heading" className="flex flex-col gap-3 rounded-xl border border-line bg-white p-5">
          <h2 id="history-heading" className="text-h4">
            Moderation history
          </h2>
          {history.length === 0 ? (
            <p className="text-body-sm text-slate-600">No decisions yet.</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {history.map((entry) => (
                <li key={entry.id} className="flex flex-col gap-0.5 text-body-sm">
                  <span className="font-medium text-ink">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                  <span className="text-caption text-slate-600">
                    {formatNairobiDateTime(entry.createdAt)}
                    {entry.actorName ? ` · ${entry.actorName}` : ""}
                  </span>
                  {entry.reason && <span className="text-slate-700">{entry.reason}</span>}
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

export default function ReviewListingPage({ params }: { params: Params }) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/listings" className="-my-3 inline-flex min-h-control items-center gap-1 self-start text-body-sm font-medium text-emerald-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to the queue
      </Link>
      <h1 className="text-h1-sm md:text-h1">Review listing</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Review params={params} />
      </Suspense>
    </div>
  );
}
