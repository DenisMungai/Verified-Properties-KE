import Link from "next/link";
import { Badge, VerifiedBadge } from "@/components/ui";
import { viewBadge, viewSummary, type ListerView } from "@/lib/verification/view";

/**
 * Design "02 — Billing & Verification" side card, built as intended (the mock's oversized text
 * overflows). Shows the real status from the verification page (prompt S12 decision 10).
 */
export function VerificationCard({ view }: { view: ListerView | null }) {
  const pill = view ? viewBadge(view) : { label: "Not verified", tone: "neutral" as const };
  const live = view?.state === "verified" && view.badgeLive;
  const line = view ? viewSummary(view) : viewSummary({ state: "not_started", listingPlanOk: false, reapply: false });
  return (
    <section aria-labelledby="verification-heading" className="flex flex-col gap-4 rounded-lg bg-mint-50 p-4 md:p-5">
      <h2 id="verification-heading" className="text-title text-emerald-700">
        Lister verification
      </h2>
      {live ? <VerifiedBadge className="self-start" /> : <Badge tone={pill.tone} className="self-start">{pill.label}</Badge>}
      <p className="text-small text-ink">{line}</p>
      <Link
        href="/account/verification"
        className="-my-3 inline-flex min-h-control items-center self-start text-small font-semibold text-emerald-700 underline underline-offset-4 hover:text-ink"
      >
        {view?.state === "not_started" || !view ? "Get verified" : "Go to verification"}
      </Link>
    </section>
  );
}
