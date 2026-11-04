import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft } from "lucide-react";
import { recordPaybillAction } from "@/app/admin/billing/actions";
import { AdminActionForm } from "@/components/admin/billing/AdminActionForm";
import { Skeleton } from "@/components/ui";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Record a Paybill payment", robots: { index: false } };

/**
 * Money on the M-Pesa statement with no callback (prompt S10 decision 9). When a callback did
 * arrive for the receipt, the server refuses a second record because receipts are unique.
 */
async function RecordForm() {
  await requireRole(ADMIN_ROLES, "/admin/billing/record");
  return (
    <div className="max-w-xl rounded-lg border border-line bg-white p-5 md:p-6">
      <AdminActionForm
        action={recordPaybillAction}
        title="Payment details from the statement"
        description="Use this only for money you can see on the M-Pesa statement. The amount must equal the invoice, and the plan becomes paid straight away."
        hidden={{}}
        fields={[
          { name: "invoiceNumber", label: "Invoice number", hint: "Like VPK0000123.", required: true, autoCapitalize: "characters", maxLength: 12 },
          { name: "receipt", label: "M-Pesa receipt", hint: "10 characters, e.g. SGR7ABC123.", required: true, autoCapitalize: "characters", maxLength: 10 },
          { name: "amountKes", label: "Amount paid (KES)", required: true, inputMode: "numeric", maxLength: 7 },
          { name: "phone", label: "Payer's phone", hint: "If the statement shows it.", inputMode: "tel", maxLength: 20 },
        ]}
        submitLabel="Record and activate"
      />
    </div>
  );
}

export default function RecordPaybillPage() {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/billing" className="-my-3 inline-flex min-h-control items-center gap-1 self-start text-small font-medium text-emerald-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to billing
      </Link>
      <h1 className="text-display-sm">Record a Paybill payment</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <RecordForm />
      </Suspense>
    </div>
  );
}
