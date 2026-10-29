import { Badge } from "@/components/ui";
import { STATUS_LABELS, STATUS_TONES, type ListingStatus } from "@/lib/listings/workflow";

/** Listing status as a text pill: the label carries the meaning, colour only supports it. */
export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  return <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>;
}
