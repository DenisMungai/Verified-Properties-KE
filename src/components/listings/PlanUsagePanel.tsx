import { Check } from "lucide-react";
import type { ListingPlanUsage } from "@/db/queries/billing";
import { FEATURED_PHOTO_COUNT } from "@/lib/storage/limits";

const TIPS = [
  "Use a clear, accurate title",
  "Include the full KSh price",
  "Add bright, genuine photos",
  "Mention nearby amenities",
  "Avoid misleading details",
];

export const PHOTO_TIPS = [
  "Add bright, genuine photos",
  "Start with the best room as your cover",
  `Listings with ${FEATURED_PHOTO_COUNT} or more photos can be featured`,
  "Avoid misleading details",
];

/** Plain-language plan state for the panel and the overview card. */
export function planUsageSummary(usage: ListingPlanUsage): { headline: string; detail: string } {
  if (usage.limit === null || usage.phase === null) {
    return { headline: "No listing plan yet", detail: "Drafts are free. You'll need a plan to publish." };
  }
  const used = `${usage.activeListingCount} of ${usage.limit} active listings used`;
  switch (usage.phase) {
    case "pending":
      return { headline: used, detail: "Your plan payment hasn't been confirmed yet." };
    case "grace":
      return { headline: used, detail: "Your plan has ended. Live listings stay up for a few days; renew to publish more." };
    case "lapsed":
      return { headline: used, detail: "Your plan has expired. Renew it to publish." };
    case "active":
      return { headline: used, detail: "" };
  }
}

/** Design "04 — Create Listing" side panel: tips plus "Your current plan" with a usage bar. */
export function PlanUsagePanel({ usage, tips = TIPS }: { usage: ListingPlanUsage; tips?: string[] }) {
  const { headline, detail } = planUsageSummary(usage);
  const percent = usage.limit ? Math.min(100, Math.round((usage.activeListingCount / usage.limit) * 100)) : 0;
  return (
    <aside aria-labelledby="listing-tips-heading" className="flex flex-col gap-8 rounded-xl bg-mint-50 p-6">
      <div className="flex flex-col gap-4">
        <h2 id="listing-tips-heading" className="text-h4 text-emerald-700">
          A stronger listing
        </h2>
        <ul className="flex flex-col gap-3">
          {tips.map((tip) => (
            <li key={tip} className="flex items-start gap-2 text-body-sm text-emerald-700">
              <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {tip}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-body-sm font-semibold text-ink">Your current plan</h3>
        <p className="text-caption text-slate-700">{headline}</p>
        {usage.limit !== null && (
          <div
            role="progressbar"
            aria-label="Active listings used"
            aria-valuemin={0}
            aria-valuemax={usage.limit}
            aria-valuenow={Math.min(usage.activeListingCount, usage.limit)}
            className="h-2 overflow-hidden rounded-pill bg-line"
          >
            <div className="h-full rounded-pill bg-emerald-600" style={{ width: `${percent}%` }} />
          </div>
        )}
        {detail && <p className="text-caption text-slate-700">{detail}</p>}
      </div>
    </aside>
  );
}
