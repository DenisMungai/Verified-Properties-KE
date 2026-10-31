import { formatKes } from "@/lib/format";
import { cn } from "@/lib/cn";

/** Paying an open invoice to the Paybill, with the invoice number as the account (plan v2.0 §4). */
export function PaybillInstructions({
  paybill,
  invoiceNumber,
  amountKes,
  title = "Pay by Paybill",
  className,
}: {
  paybill: string;
  invoiceNumber: string;
  amountKes: number;
  title?: string;
  className?: string;
}) {
  const rows = [
    ["Business number", paybill],
    ["Account number", invoiceNumber],
    ["Amount", formatKes(amountKes)],
  ] as const;
  return (
    <section aria-labelledby="paybill-heading" className={cn("flex flex-col gap-3 rounded-lg bg-mint-50 p-4 md:p-5", className)}>
      <h2 id="paybill-heading" className="text-title text-emerald-700">
        {title}
      </h2>
      <p className="text-small text-ink">
        On your phone open M-Pesa, choose Lipa na M-Pesa, then Pay Bill, and enter these details exactly. Your plan
        activates as soon as the payment arrives.
      </p>
      <dl className="grid gap-2 sm:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-0.5 rounded-md bg-white px-4 py-3">
            <dt className="text-micro text-slate-600">{label}</dt>
            <dd className="text-body font-semibold text-ink tabular">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
