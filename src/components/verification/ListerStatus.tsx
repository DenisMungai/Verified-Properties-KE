import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, VerifiedBadge, buttonClasses } from "@/components/ui";
import { formatKes, formatNairobiDate } from "@/lib/format";
import { DOCUMENT_LABELS, type DocumentType } from "@/lib/verification/rules";
import { viewBadge, type ListerView } from "@/lib/verification/view";

const CHECKOUT = (code: string) => `/account/billing/checkout?plan=${encodeURIComponent(code)}`;
const LISTING_CHECKOUT = "/account/billing/checkout";

function Panel({ title, badge, children }: { title: string; badge: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby="verification-status-heading" className="flex flex-col gap-4 rounded-lg bg-mint-50 p-5 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="verification-status-heading" className="text-title text-emerald-700">
          {title}
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

function Reason({ label, reason }: { label: string; reason: string | null }) {
  if (!reason) return null;
  return (
    <div className="flex flex-col gap-1 rounded-sm border border-line bg-white p-3">
      <p className="text-micro font-semibold uppercase tracking-wide text-slate-600">{label}</p>
      <p className="whitespace-pre-line text-small text-ink">{reason}</p>
    </div>
  );
}

/** What gets checked, by lister type: shown before paying so nobody pays without knowing. */
function WhatWeCheck({ required }: { required: DocumentType[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-small font-semibold text-ink">You&apos;ll upload:</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-small text-ink">
        {required.map((type) => (
          <li key={type}>
            {DOCUMENT_LABELS[type].label}
            <span className="block text-micro text-slate-600">{DOCUMENT_LABELS[type].hint}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StartAction({ listingPlanOk, planCode, label }: { listingPlanOk: boolean; planCode: string | null; label: string }) {
  if (!listingPlanOk) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-small text-warning-text">Verification needs an active listing plan. Choose or renew a plan first.</p>
        <Link href={LISTING_CHECKOUT} className={buttonClasses({ className: "self-start" })}>
          Choose a listing plan
        </Link>
      </div>
    );
  }
  if (!planCode) return <p className="text-small text-slate-700">Verification isn&apos;t available right now. Please check back later.</p>;
  return (
    <Link href={CHECKOUT(planCode)} className={buttonClasses({ className: "self-start" })}>
      {label}
    </Link>
  );
}

/**
 * The lister's verification status (prompt S12 decision 10), one state at a time. The badge wording
 * is fixed: "Profile verified" confirms the profile checks, never a licence or a property guarantee.
 */
export function ListerStatus({
  view,
  required,
  plan,
}: {
  view: ListerView;
  required: DocumentType[];
  plan: { code: string; priceKes: number } | null;
}) {
  const pill = viewBadge(view);
  const badge = view.state === "verified" && view.badgeLive ? <VerifiedBadge /> : <Badge tone={pill.tone}>{pill.label}</Badge>;
  const price = plan ? `${formatKes(plan.priceKes)} / 30 days` : null;

  switch (view.state) {
    case "not_started":
      return (
        <Panel title={view.reapply ? "Verify your profile again" : "Get the verified badge"} badge={badge}>
          <p className="text-small text-ink">
            An admin checks your documents. Once approved, your listings show &ldquo;Profile verified&rdquo;, rank first in search and
            go live without pre-review, and buyers see your phone number.{price ? ` Verification costs ${price}.` : ""} Paying alone
            never makes anyone verified.
          </p>
          <WhatWeCheck required={required} />
          <StartAction listingPlanOk={view.listingPlanOk} planCode={plan?.code ?? null} label="Start verification" />
        </Panel>
      );
    case "awaiting_payment":
      return (
        <Panel title="Finish paying for verification" badge={badge}>
          <p className="text-small text-ink">
            Your review starts as soon as the payment is confirmed. If you&apos;ve just paid, this page updates within a minute.
          </p>
          <StartAction listingPlanOk={view.listingPlanOk} planCode={plan?.code ?? null} label="Pay for verification" />
        </Panel>
      );
    case "upload":
      return (
        <Panel title={view.changesReason ? "Update your documents" : "Upload your documents"} badge={badge}>
          {view.changesReason ? (
            <Reason label="What our team asked for" reason={view.changesReason} />
          ) : (
            <p className="text-small text-ink">Payment received. Add each document below, then submit it for review.</p>
          )}
        </Panel>
      );
    case "under_review":
      return (
        <Panel title="Your documents are under review" badge={badge}>
          <p className="text-small text-ink">
            {view.submittedAt ? `Submitted on ${formatNairobiDate(view.submittedAt)}. ` : ""}We usually decide within 2 working days and
            will email you when we do.
          </p>
        </Panel>
      );
    case "verified":
      return (
        <Panel title={view.badgeLive ? "Your profile is verified" : "Your badge is paused"} badge={badge}>
          {view.badgeLive ? (
            <p className="text-small text-ink">
              Your review is valid until {formatNairobiDate(view.expiresAt)}. Keep your verification and listing plans paid to keep
              the badge.
            </p>
          ) : (
            <>
              <p className="text-small text-ink">
                Your review is valid until {formatNairobiDate(view.expiresAt)}, but a plan has lapsed, so the badge is hidden. Renew
                and it comes back straight away, with no new review.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                {plan && (
                  <Link href={CHECKOUT(plan.code)} className={buttonClasses()}>
                    Renew verification
                  </Link>
                )}
                <Link href="/account/billing" className={buttonClasses({ variant: "secondary" })}>
                  Check your plans
                </Link>
              </div>
            </>
          )}
        </Panel>
      );
    case "rejected":
      return (
        <Panel title="Your verification wasn't approved" badge={badge}>
          <Reason label="Reason" reason={view.reason} />
          <p className="text-small text-ink">
            {view.credit?.kind === "credited"
              ? `Your fee was credited to your listing plan: ${view.credit.note}.`
              : "Our billing team will contact you about refunding your fee."}
          </p>
          <WhatWeCheck required={required} />
          <StartAction listingPlanOk={view.listingPlanOk} planCode={plan?.code ?? null} label="Apply again" />
        </Panel>
      );
    case "suspended":
      return (
        <Panel title="Your verification is suspended" badge={badge}>
          <Reason label="Reason" reason={view.reason} />
          <p className="text-small text-ink">Your badge is hidden. Contact support if you think this is a mistake.</p>
        </Panel>
      );
  }
}
