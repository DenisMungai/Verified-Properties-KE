import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { changeListingStatusAction } from "@/app/account/listings/actions";
import { Button, buttonClasses } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  LISTER_TRANSITION_TARGETS,
  TRANSITION_LABELS,
  canDeleteDraft,
  listerCanTransition,
  type ListerTransitionTarget,
  type ListingStatus,
  type ListingType,
} from "@/lib/listings/workflow";

export interface ActionableListing {
  id: string;
  status: ListingStatus;
  listingType: ListingType;
  publishedAt: Date | null;
  reviewedAt: Date | null;
}

/** What each final step means, shown before the confirm button. */
const CONSEQUENCES: Record<Exclude<ListerTransitionTarget, "draft"> | "delete", string> = {
  rented: "It leaves search. You can archive it later.",
  sold: "It leaves search. You can archive it later.",
  withdrawn: "It leaves search and can't be published again.",
  archived: "It's kept for your records but can't be edited or published again.",
  delete: "The draft is deleted permanently.",
};

function StatusForm({
  listingId,
  intent,
  label,
  variant = "secondary",
  className,
}: {
  listingId: string;
  intent: string;
  label: string;
  variant?: "primary" | "secondary" | "danger" | "ghost";
  className?: string;
}) {
  return (
    <form action={changeListingStatusAction}>
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="intent" value={intent} />
      <Button type="submit" variant={variant} className={className}>
        {label}
      </Button>
    </form>
  );
}

/** A final action behind a disclosure: the first click explains, the second confirms. */
function ConfirmStatusForm({ listingId, intent, label }: { listingId: string; intent: keyof typeof CONSEQUENCES; label: string }) {
  return (
    <details className="group rounded-md">
      <summary className="flex min-h-control cursor-pointer list-none items-center justify-between gap-2 rounded-md px-3 text-small font-medium text-ink hover:bg-canvas [&::-webkit-details-marker]:hidden">
        {label}
        <ChevronDown aria-hidden="true" className="size-4 text-slate-600 transition-transform group-open:rotate-180" />
      </summary>
      <div className="flex flex-col gap-2 px-3 pb-3 pt-1">
        <p className="text-micro text-slate-700">{CONSEQUENCES[intent]}</p>
        <StatusForm
          listingId={listingId}
          intent={intent}
          label={intent === "delete" ? "Yes, delete draft" : `Yes, ${label.toLowerCase()}`}
          variant={intent === "delete" ? "danger" : "secondary"}
          className="self-start"
        />
      </div>
    </details>
  );
}

/** The main next step for a listing, as a link or button. */
export function PrimaryListingAction({ listing, className }: { listing: ActionableListing; className?: string }) {
  const base = `/account/listings/${listing.id}`;
  const link = (href: string, label: string) => (
    <Link href={href} className={buttonClasses({ variant: "secondary", className })}>
      {label}
    </Link>
  );
  switch (listing.status) {
    case "draft":
      return link(`${base}/basics`, "Continue");
    case "rejected":
    case "published":
      return link(`${base}/basics`, "Edit");
    case "pending_review":
      return link(`${base}/preview`, "Review");
    case "paused":
      return <StatusForm listingId={listing.id} intent="unpause" label="Un-pause" variant="primary" className={className} />;
    default:
      return null;
  }
}

/** Every other status change the lister may make, under "More actions". */
export function MoreListingActions({ listing, align = "end" }: { listing: ActionableListing; align?: "start" | "end" }) {
  const targets = LISTER_TRANSITION_TARGETS.filter((to) =>
    listerCanTransition(listing.status, to, { listingType: listing.listingType }),
  );
  const deletable = canDeleteDraft(listing);
  if (targets.length === 0 && !deletable) return null;

  return (
    // Keyed by status: after an action redirects back, the menu remounts closed.
    <details key={listing.status} className="group/more relative">
      <summary
        className={cn(
          buttonClasses({ variant: "ghost" }),
          "list-none [&::-webkit-details-marker]:hidden",
        )}
      >
        More actions
        <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open/more:rotate-180" />
      </summary>
      <div
        className={cn(
          "z-10 mt-2 flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-1 rounded-lg border border-line bg-white p-2 md:absolute",
          align === "end" ? "md:right-0" : "md:left-0",
        )}
      >
        {targets.map((to) =>
          to === "draft" ? (
            <StatusForm
              key={to}
              listingId={listing.id}
              intent={to}
              label={TRANSITION_LABELS[to]}
              variant="ghost"
              className="w-full justify-start text-ink"
            />
          ) : (
            <ConfirmStatusForm key={to} listingId={listing.id} intent={to} label={TRANSITION_LABELS[to]} />
          ),
        )}
        {deletable && <ConfirmStatusForm listingId={listing.id} intent="delete" label="Delete draft" />}
      </div>
    </details>
  );
}
