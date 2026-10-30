import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { formatKes } from "@/lib/format";
import { cn } from "@/lib/cn";
import { listingLimitLine, planAudience } from "./plan-copy";

/** A plan on the pricing page: name, who it suits, price per 30 days, listing limit, call to action. */
export function PlanCard({
  code,
  name,
  priceKes,
  listingLimit,
  terms,
  action,
  highlighted = false,
}: {
  code: string;
  name: string;
  priceKes: number;
  listingLimit: number | null;
  terms: string;
  action: ReactNode;
  highlighted?: boolean;
}) {
  const audience = planAudience(code);
  const headingId = `plan-${code}-heading`;
  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-6 rounded-xl border bg-white p-4 md:p-6",
        highlighted ? "border-emerald-600 ring-1 ring-emerald-600" : "border-line",
      )}
    >
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="text-h3">
          {name}
        </h2>
        {audience && <p className="text-body-sm text-slate-600">{audience}</p>}
      </div>
      <p className="flex items-baseline gap-2">
        <span className="text-h1 tabular">{formatKes(priceKes)}</span>
        <span className="text-body-sm text-slate-600">/ 30 days</span>
      </p>
      <ul className="flex flex-col gap-2 text-body-sm text-ink">
        <li className="flex items-start gap-2">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          {listingLimitLine(listingLimit)}
        </li>
        <li className="flex items-start gap-2">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          Drafts and photos are always free
        </li>
        <li className="flex items-start gap-2">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          {terms}
        </li>
      </ul>
      <div className="mt-auto">{action}</div>
    </section>
  );
}
