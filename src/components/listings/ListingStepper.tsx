import Link from "next/link";
import { cn } from "@/lib/cn";

export type ListingStepKey = "basics" | "details" | "photos" | "preview";

const STEPS: { key: ListingStepKey; label: string }[] = [
  { key: "basics", label: "Basics" },
  { key: "details", label: "Details" },
  { key: "photos", label: "Photos" },
  { key: "preview", label: "Preview" },
];

/**
 * Design "04 — Create Listing" stepper: a white card with numbered steps; the current one in
 * Forest. Steps link once the draft exists, so they can be revisited in any order.
 */
export function ListingStepper({ listingId, current }: { listingId?: string; current: ListingStepKey }) {
  return (
    <nav aria-label="Listing steps" className="rounded-xl border border-line bg-white px-2 py-3 sm:px-6">
      <ol className="flex items-center gap-1 sm:gap-6">
        {STEPS.map((step, index) => {
          const isCurrent = step.key === current;
          const content = (
            <>
              <span className="tabular">{index + 1}</span>
              <span>{step.label}</span>
            </>
          );
          const classes = cn(
            // Four steps fit one row at 390px with caption-size labels; body-sm from sm up.
            "flex min-h-control items-center gap-1 rounded-md px-1 text-caption sm:gap-2 sm:px-2 sm:text-body-sm",
            isCurrent ? "font-semibold text-emerald-700" : "font-medium text-slate-600",
          );
          return (
            <li key={step.key} className="flex-1">
              {listingId && !isCurrent ? (
                <Link href={`/account/listings/${listingId}/${step.key}`} className={cn(classes, "hover:text-ink")}>
                  {content}
                </Link>
              ) : (
                <span className={classes} aria-current={isCurrent ? "step" : undefined}>
                  {content}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
