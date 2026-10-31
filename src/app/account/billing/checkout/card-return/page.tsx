import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeading } from "@/components/account/PageHeading";
import { PaymentStatusPanel } from "@/components/billing/PaymentStatusPanel";
import { FormAlert } from "@/components/forms/FormAlert";
import { Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { getCardPaymentForUser } from "@/db/queries/billing-page";
import { checkoutPath } from "@/lib/billing/receipt-path";
import { CARD_REFERENCE_PATTERN } from "@/lib/card/config";
import { single, type SearchParams } from "@/lib/search-params";
import { requireLister } from "../../../listings/guard";

export const metadata: Metadata = { title: "Card payment" };

/**
 * Where Paystack sends the payer back (prompt S6 decision 16). Nothing is trusted from the URL:
 * the reference must belong to the user, and the status panel's first poll runs Verify.
 */
async function CardReturn({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireLister("/account/billing"), searchParams]);
  const reference = single(params.reference) ?? single(params.trxref);
  const payment =
    reference && CARD_REFERENCE_PATTERN.test(reference) ? await getCardPaymentForUser(getDb(), user.id, reference) : null;
  if (!payment || payment.method !== "card") {
    return <FormAlert state={{ formError: "We couldn't find that card payment. Open your billing page to see your invoices." }} />;
  }
  return (
    <PaymentStatusPanel
      paymentId={payment.id}
      method="card"
      invoiceNumber={payment.invoiceNumber}
      planName={payment.planName}
      amountKes={payment.amountKes}
      paybill={null}
      retryHref={checkoutPath()}
    />
  );
}

export default function CardReturnPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Card payment" />
      <Suspense fallback={<Skeleton className="h-48 rounded-lg" />}>
        <CardReturn searchParams={searchParams} />
      </Suspense>
    </>
  );
}
