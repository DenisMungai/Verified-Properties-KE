import "server-only";
import Link from "next/link";
import { buttonClasses, type ButtonVariant } from "@/components/ui";
import type { ButtonSize } from "@/components/ui/Button";
import { getDb } from "@/db";
import { getActivePlans } from "@/db/queries/billing";
import { BILLING_PERIOD_DAYS } from "@/lib/billing/constants";
import { formatKes } from "@/lib/format";
import { signInPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/lib/session";
import { VERIFICATION_PATH } from "@/lib/verification/app-deps";

/**
 * The public face of the verification add-on (prompt S14 decisions 7–8), shared by `/pricing`
 * and `/how-it-works`. Every reader runs at request time, so callers wrap them in `<Suspense>`.
 */

/** The active verification plan's price, or null when none is on sale. Read from `plans`, never hard-coded. */
export async function activeVerificationPriceKes(): Promise<number | null> {
  const plans = await getActivePlans(getDb(), "verification");
  const plan = plans.find((candidate) => candidate.priceKes > 0);
  return plan?.priceKes ?? null;
}

export function verificationPeriodLabel(): string {
  return `per ${BILLING_PERIOD_DAYS} days`;
}

/** "KSh 1,500 per 30 days", or the not-yet-priced line. */
export async function VerificationPrice({ className }: { className?: string }) {
  const priceKes = await activeVerificationPriceKes();
  if (priceKes === null) return <span className={className}>Pricing will be announced soon.</span>;
  return (
    <span className={className}>
      <strong className="tabular font-semibold text-ink">{formatKes(priceKes)}</strong> {verificationPeriodLabel()}
    </span>
  );
}

/** Where "Get verified" goes: the verification page, through sign-in unless the email is verified. */
export async function getVerifiedHref(): Promise<string> {
  const user = await getCurrentUser();
  return user?.emailVerified ? VERIFICATION_PATH : signInPath(VERIFICATION_PATH);
}

export async function GetVerifiedLink({ variant = "secondary", size = "lg" }: { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <Link href={await getVerifiedHref()} className={buttonClasses({ variant, size })}>
      Get verified
    </Link>
  );
}
