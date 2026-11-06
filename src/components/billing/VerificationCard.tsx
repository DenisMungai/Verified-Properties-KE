import Link from "next/link";
import { Badge, VerifiedBadge } from "@/components/ui";
import { viewBadge, type ListerView } from "@/lib/verification/view";

const LINES: Record<ListerView["state"], string> = {
  not_started: "Paid verification with an admin review. The badge appears only after a review passes.",
  awaiting_payment: "Your review starts once the verification payment is confirmed.",
  upload: "Payment received. Upload your documents to start the review.",
  under_review: "Your documents are with our team, usually decided within 2 working days.",
  verified: "Your listings show the badge and rank first while both plans are paid.",
  rejected: "Your last review wasn't approved. See why, and apply again when ready.",
  suspended: "Your badge is suspended. See the reason on the verification page.",
};

/**
 * Design "02 — Billing & Verification" side card, built as intended (the mock's oversized text
 * overflows). Shows the real status from the verification page (prompt S12 decision 10).
 */
export function VerificationCard({ view }: { view: ListerView | null }) {
  const pill = view ? viewBadge(view) : { label: "Not verified", tone: "neutral" as const };
  const live = view?.state === "verified" && view.badgeLive;
  const line = view?.state === "verified" && !view.badgeLive ? "A plan has lapsed, so your badge is hidden. Renew to restore it." : LINES[view?.state ?? "not_started"];
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
