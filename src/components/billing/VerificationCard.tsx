import { Badge } from "@/components/ui";

/**
 * Design "02 — Billing & Verification" side card, built as intended (the mock's oversized text
 * overflows). Paid verification arrives in Phase 2; nothing here implies anyone is verified.
 */
export function VerificationCard() {
  return (
    <section aria-labelledby="verification-heading" className="flex flex-col gap-4 rounded-xl bg-mint-50 p-4 md:p-6">
      <h2 id="verification-heading" className="text-h4 text-emerald-700">
        Lister verification
      </h2>
      <p className="text-body-sm text-ink">
        Paid verification with admin review arrives soon. The badge says &ldquo;Profile verified&rdquo; and appears only
        after a review passes.
      </p>
      <Badge className="self-start">Not verified</Badge>
    </section>
  );
}
