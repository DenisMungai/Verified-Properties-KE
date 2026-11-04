import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { applyPaybillAction, refundPaybillAction } from "@/app/admin/billing/actions";
import { AdminActionForm } from "@/components/admin/billing/AdminActionForm";
import { Facts } from "@/components/admin/billing/BillingTables";
import { FormAlert } from "@/components/forms/FormAlert";
import { Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { getPaybillEvent } from "@/db/queries/billing-admin";
import { formatKes, formatNairobiDateTime } from "@/lib/format";
import { displayKenyanPhone, normalizeKenyanPhone } from "@/lib/kenya";
import { ADMIN_ROLES } from "@/lib/roles";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";
import { idSchema } from "@/lib/validation/billing-admin";

export const metadata: Metadata = { title: "Unmatched Paybill payment", robots: { index: false } };

type Params = Promise<{ eventId: string }>;

const NOTICES: Record<string, string> = { refunded: "Refund recorded. This money is resolved." };

function phone(msisdn: string | null): string {
  if (!msisdn) return "Not sent";
  const normalized = normalizeKenyanPhone(msisdn);
  return normalized ? displayKenyanPhone(normalized.e164) : `${msisdn} (masked by M-Pesa)`;
}

async function Paybill({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole(ADMIN_ROLES, "/admin/billing");
  const [{ eventId }, query] = await Promise.all([params, searchParams]);
  if (!idSchema.safeParse(eventId).success) notFound();
  await connection();
  const found = await getPaybillEvent(getDb(), eventId);
  if (!found) notFound();
  const { event, resolution } = found;
  const notice = NOTICES[single(query.notice) ?? ""];

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-6">
        {notice && <FormAlert state={{ message: notice }} />}
        <section aria-labelledby="money-heading" className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5 md:p-6">
          <h2 id="money-heading" className="text-title">
            What M-Pesa sent
          </h2>
          <Facts
            rows={[
              ["Received", formatNairobiDateTime(event.createdAt)],
              ["Receipt", event.transId ?? "Unreadable"],
              ["Amount", event.amountKes !== null ? formatKes(event.amountKes) : "Not a whole shilling amount"],
              ["Account number typed", event.billRef || "None"],
              ["Phone", phone(event.msisdn)],
              ["Source IP", event.sourceIp ?? "Unknown"],
            ]}
          />
          <details>
            <summary className="inline-flex min-h-control cursor-pointer items-center text-small font-medium text-emerald-700 hover:underline">
              Show the full callback
            </summary>
            <pre className="mt-1 max-h-80 overflow-auto rounded-md bg-canvas p-3 text-micro text-slate-700">{JSON.stringify(event.payload, null, 2)}</pre>
          </details>
        </section>
      </div>

      <section aria-labelledby="resolve-heading" className="flex flex-col gap-5 rounded-lg border border-line bg-white p-5 md:p-6">
        <h2 id="resolve-heading" className="text-title">
          Resolve
        </h2>
        {resolution?.kind === "payment" ? (
          <p className="text-small text-slate-700">
            Already applied.{" "}
            <Link href={`/admin/billing/payments/${resolution.paymentId}`} className="font-medium text-emerald-700 hover:underline">
              Open the payment
            </Link>
          </p>
        ) : resolution?.kind === "refunded" ? (
          <p className="text-small text-slate-700">
            Refund recorded on {formatNairobiDateTime(resolution.at)}
            {resolution.reference ? ` (ref ${resolution.reference})` : ""}.
          </p>
        ) : !event.transId ? (
          <p className="text-small text-slate-700">M-Pesa sent something we couldn&apos;t read, so it can&apos;t be applied. Check the statement.</p>
        ) : (
          <div className="flex flex-col gap-5 [&>*+*]:border-t [&>*+*]:border-line [&>*+*]:pt-5">
            <AdminActionForm
              action={applyPaybillAction}
              title="Apply to an invoice"
              description="Ask the lister for their invoice number. The receipt and amount come from this callback, and the amount must equal the invoice."
              hidden={{ eventId: event.id }}
              fields={[{ name: "invoiceNumber", label: "Invoice number", hint: "Like VPK0000123.", required: true, autoCapitalize: "characters", maxLength: 12 }]}
              submitLabel="Apply and activate"
            />
            <AdminActionForm
              action={refundPaybillAction}
              title="Record refund"
              description="Send the money back from the M-Pesa org portal first, then record it here."
              hidden={{ eventId: event.id }}
              fields={[
                { name: "reference", label: "Refund reference", hint: "The reversal receipt.", required: true, maxLength: 100 },
                {
                  name: "amountKes",
                  label: "Amount refunded (KES)",
                  required: true,
                  inputMode: "numeric",
                  maxLength: 7,
                  defaultValue: event.amountKes !== null ? String(event.amountKes) : "",
                },
              ]}
              submitLabel="Record refund"
              variant="danger"
            />
          </div>
        )}
      </section>
    </div>
  );
}

export default function PaybillEventPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/billing" className="-my-3 inline-flex min-h-control items-center gap-1 self-start text-small font-medium text-emerald-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to billing
      </Link>
      <h1 className="text-display-sm">Unmatched Paybill payment</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <Paybill params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
