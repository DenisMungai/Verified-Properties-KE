import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import {
  activatePaymentAction,
  closePaymentAction,
  creditFromPaymentAction,
  goodwillCreditAction,
  refundPaymentAction,
} from "@/app/admin/billing/actions";
import { AdminActionForm } from "@/components/admin/billing/AdminActionForm";
import { AuditList, EventLog, Facts, PaymentStatusBadge, PaymentTable, phoneLabel } from "@/components/admin/billing/BillingTables";
import { FormAlert } from "@/components/forms/FormAlert";
import { Badge, Skeleton, type BadgeTone } from "@/components/ui";
import { getDb } from "@/db";
import {
  auditEntriesFor,
  findPaybillEventByTransId,
  getAdminPaymentDetail,
  paymentEventLog,
  paymentsOnInvoice,
  type AdminPaymentDetail,
} from "@/db/queries/billing-admin";
import { PAYMENT_METHOD_LABELS, flagReasonLabel } from "@/lib/billing/admin-view";
import { canReceiveCredit, creditDaysFromPayment, MAX_GOODWILL_CREDIT_DAYS } from "@/lib/billing/credit";
import { subscriptionPhase, type SubscriptionPhase } from "@/lib/billing/periods";
import { formatKes, formatNairobiDate, formatNairobiDateTime } from "@/lib/format";
import { ADMIN_ROLES } from "@/lib/roles";
import { single, type SearchParams } from "@/lib/search-params";
import { requireRole } from "@/lib/session";
import { idSchema } from "@/lib/validation/billing-admin";

export const metadata: Metadata = { title: "Payment", robots: { index: false } };

type Params = Promise<{ id: string }>;

const NOTICES: Record<string, string> = {
  activated: "Payment activated. The plan is paid and the lister's receipt is on its way.",
  refunded: "Refund recorded.",
  closed: "Payment closed. Nothing changed on the plan.",
  credited: "Payment turned into plan days.",
  credit_added: "Credit added to the plan.",
  applied: "Paybill money applied. The plan is paid.",
  recorded: "Paybill payment recorded. The plan is paid.",
};

const PHASES: Record<SubscriptionPhase, { label: string; tone: BadgeTone }> = {
  active: { label: "Active", tone: "success" },
  grace: { label: "In grace", tone: "warning" },
  pending: { label: "Not paid yet", tone: "neutral" },
  lapsed: { label: "Lapsed", tone: "danger" },
};

const ACTIVATABLE = ["missing_receipt", "callback_query_mismatch"];
const CREDITABLE = ["invoice_not_open", "amount_mismatch"];

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5 md:p-6">
      <h2 id={id} className="text-title">
        {title}
      </h2>
      {children}
    </section>
  );
}

function FlaggedActions({ detail, now }: { detail: AdminPaymentDetail; now: Date }) {
  const { payment, subscription } = detail;
  const reason = payment.flagReason ?? "";
  const hidden = { paymentId: payment.id };
  const forms: ReactNode[] = [];

  if (payment.method !== "card" && ACTIVATABLE.includes(reason)) {
    forms.push(
      <AdminActionForm
        key="activate"
        action={activatePaymentAction}
        title="Activate"
        description={`Only after you've found this money on the M-Pesa statement. The plan starts a paid period from now.${
          payment.mpesaReceipt ? ` Receipt from the callback: ${payment.mpesaReceipt}.` : ""
        }${payment.paidAmountKes !== null ? ` Amount from the callback: ${formatKes(payment.paidAmountKes)}.` : ""}`}
        hidden={hidden}
        fields={[
          ...(payment.mpesaReceipt
            ? []
            : [{ name: "receipt", label: "M-Pesa receipt", hint: "From the statement, e.g. SGR7ABC123.", required: true, autoCapitalize: "characters" as const, maxLength: 10 }]),
          ...(payment.paidAmountKes !== null
            ? []
            : [{ name: "amountKes", label: "Amount paid (KES)", hint: `The invoice is ${formatKes(detail.invoice.amountKes)}.`, required: true, inputMode: "numeric" as const, maxLength: 7 }]),
        ]}
        submitLabel="Activate plan"
      />,
    );
  }

  if (CREDITABLE.includes(reason) && payment.paidAmountKes) {
    const eligible = canReceiveCredit(subscription, now);
    const days = creditDaysFromPayment(payment.paidAmountKes, subscription.planPriceKes);
    forms.push(
      eligible && days > 0 ? (
        <AdminActionForm
          key="credit"
          action={creditFromPaymentAction}
          title="Turn into plan days"
          description={`Adds about ${days} ${days === 1 ? "day" : "days"} to the ${subscription.planName} plan (${formatKes(payment.paidAmountKes)} at ${formatKes(subscription.planPriceKes)} per 30 days). The server works out the final number.`}
          hidden={hidden}
          submitLabel="Add the days"
          variant="secondary"
        />
      ) : (
        <p key="credit" className="text-small text-slate-600">
          {eligible ? "This amount is worth less than a day of the plan, so it can't become a credit." : "The plan isn't paid up, so this can't become a credit. Refund it instead."}
        </p>
      ),
    );
  }

  forms.push(
    <AdminActionForm
      key="refund"
      action={refundPaymentAction}
      title="Record refund"
      description="Send the money back first (M-Pesa org portal or the Paystack dashboard), then record it here."
      hidden={hidden}
      fields={[
        { name: "reference", label: "Refund reference", hint: "The reversal or refund receipt.", required: true, maxLength: 100 },
        {
          name: "amountKes",
          label: "Amount refunded (KES)",
          required: true,
          inputMode: "numeric",
          maxLength: 7,
          defaultValue: payment.paidAmountKes !== null ? String(payment.paidAmountKes) : "",
          hint: payment.paidAmountKes !== null ? `At most ${formatKes(payment.paidAmountKes)}.` : undefined,
        },
      ]}
      submitLabel="Record refund"
      variant="danger"
    />,
  );

  forms.push(
    <AdminActionForm
      key="close"
      action={closePaymentAction}
      title="Close, no money kept"
      description="For a duplicate record, or when you've checked that no money arrived."
      hidden={hidden}
      submitLabel="Close payment"
      variant="danger"
    />,
  );

  return (
    <div className="flex flex-col gap-5 [&>*+*]:border-t [&>*+*]:border-line [&>*+*]:pt-5">
      <p className="rounded-md bg-warning-tint px-4 py-3 text-small text-warning-text">Flagged: {flagReasonLabel(payment.flagReason)}.</p>
      {forms}
    </div>
  );
}

async function PaymentDetail({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await requireRole(ADMIN_ROLES, "/admin/billing");
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!idSchema.safeParse(id).success) notFound();
  await connection();
  const db = getDb();
  const detail = await getAdminPaymentDetail(db, id);
  if (!detail) notFound();
  const { payment, invoice, subscription, owner } = detail;
  const [events, audit, siblings, paybillEvent] = await Promise.all([
    paymentEventLog(db, payment.id, invoice.id),
    auditEntriesFor(db, { paymentId: payment.id, invoiceId: invoice.id, subscriptionId: subscription.id }),
    paymentsOnInvoice(db, invoice.id),
    payment.method === "manual" && payment.mpesaReceipt ? findPaybillEventByTransId(db, payment.mpesaReceipt) : Promise.resolve(null),
  ]);
  const now = new Date();
  const phase = PHASES[subscriptionPhase(subscription, now)];
  const notice = NOTICES[single(query.notice) ?? ""];
  const others = siblings.filter((row) => row.id !== payment.id);

  return (
    <div className="flex flex-col gap-6">
      {notice && <FormAlert state={{ message: notice }} />}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section id="payment-heading" title="Payment">
            <div className="flex flex-wrap items-center gap-2">
              <PaymentStatusBadge status={payment.status} />
              {payment.flagReason && payment.status !== "flagged" && <Badge tone="neutral">Was flagged: {flagReasonLabel(payment.flagReason)}</Badge>}
            </div>
            {paybillEvent && (
              <p className="text-small text-slate-700">
                A Paybill callback for this receipt arrived on {formatNairobiDateTime(paybillEvent.createdAt)}.{" "}
                <Link href={`/admin/billing/paybill/${paybillEvent.id}`} className="font-medium text-emerald-700 hover:underline">
                  Open the callback
                </Link>
              </p>
            )}
            <Facts
              rows={[
                ["Method", PAYMENT_METHOD_LABELS[payment.method]],
                ["Started", formatNairobiDateTime(payment.createdAt)],
                ["Phone", phoneLabel(payment.phoneE164)],
                ["Invoice amount", formatKes(payment.amountKes)],
                ["Paid amount", payment.paidAmountKes !== null ? formatKes(payment.paidAmountKes) : "Not reported"],
                ["M-Pesa receipt", payment.mpesaReceipt ?? "None"],
                ...(payment.providerReference
                  ? ([["Card reference", `${payment.providerReference}${payment.cardLast4 ? ` · •••• ${payment.cardLast4}` : ""}`]] as [string, string][])
                  : []),
                ...(payment.checkoutRequestId ? ([["CheckoutRequestID", payment.checkoutRequestId]] as [string, string][]) : []),
                ["Result", payment.resultCode !== null ? `${payment.resultCode} · ${payment.resultDesc ?? ""}` : payment.hasCallback ? "Callback stored" : "No callback"],
                ["Confirmed", payment.confirmedAt ? formatNairobiDateTime(payment.confirmedAt) : "Not confirmed"],
              ]}
            />
          </Section>

          <Section id="invoice-heading" title="Invoice and plan">
            <Facts
              rows={[
                ["Invoice", invoice.invoiceNumber],
                ["Invoice status", invoice.status],
                ["Plan on invoice", `${invoice.planName} · ${formatKes(invoice.amountKes)}`],
                ["Period paid", invoice.periodStart && invoice.periodEnd ? `${formatNairobiDate(invoice.periodStart)} – ${formatNairobiDate(invoice.periodEnd)}` : "Not paid"],
                ["Owner", owner ? `${owner.name}${owner.kind === "agency" ? " (agency)" : ""}` : "Unknown owner"],
                ...(owner?.email ? ([["Owner email", owner.email]] as [string, string][]) : []),
              ]}
            />
            {others.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-small font-semibold text-ink">Other payments on this invoice</h3>
                <PaymentTable rows={others} caption="Other payments on this invoice" />
              </div>
            )}
          </Section>

          <Section id="events-heading" title="Event log">
            <EventLog events={events} />
          </Section>
        </div>

        <div className="flex flex-col gap-6">
          {payment.status === "flagged" && (
            <Section id="resolve-heading" title="Resolve">
              <FlaggedActions detail={detail} now={now} />
            </Section>
          )}

          <Section id="subscription-heading" title="Subscription">
            <div className="flex flex-wrap gap-2">
              <Badge tone={phase.tone}>{phase.label}</Badge>
              <Badge tone="neutral">{subscription.kind === "listing" ? "Listing plan" : "Verification"}</Badge>
            </div>
            <Facts
              rows={[
                ["Plan", `${subscription.planName} · ${formatKes(subscription.planPriceKes)}`],
                ["Paid until", subscription.currentPeriodEnd ? formatNairobiDateTime(subscription.currentPeriodEnd) : "Not paid"],
                ["Grace ends", subscription.graceEndsAt ? formatNairobiDateTime(subscription.graceEndsAt) : "None"],
                ...(subscription.scheduledChangeAt ? ([["Plan change", formatNairobiDate(subscription.scheduledChangeAt)]] as [string, string][]) : []),
              ]}
            />
            {canReceiveCredit(subscription, now) ? (
              <div className="border-t border-line pt-4">
                <AdminActionForm
                  action={goodwillCreditAction}
                  title="Add a goodwill credit"
                  description="Adds days to the paid period, for example after an outage."
                  hidden={{ subscriptionId: subscription.id, paymentId: payment.id }}
                  fields={[{ name: "days", label: "Days", hint: `1 to ${MAX_GOODWILL_CREDIT_DAYS}.`, required: true, inputMode: "numeric", maxLength: 2 }]}
                  submitLabel="Add credit"
                  variant="secondary"
                />
              </div>
            ) : (
              <p className="text-small text-slate-600">Credits only extend a paid period, so none can be added now.</p>
            )}
          </Section>

          <Section id="audit-heading" title="Admin actions">
            <AuditList entries={audit} />
          </Section>
        </div>
      </div>
    </div>
  );
}

export default function AdminPaymentPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/billing" className="-my-3 inline-flex min-h-control items-center gap-1 self-start text-small font-medium text-emerald-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to billing
      </Link>
      <h1 className="text-display-sm">Payment</h1>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <PaymentDetail params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
