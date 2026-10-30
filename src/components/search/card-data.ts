import "server-only";
import type { PublicListingCard } from "@/db/queries/public-listings";
import { publicImageBaseUrl } from "@/lib/storage";
import type { PropertyCardData } from "./PropertyCard";

/** Resolves each cover to its public URL; the storage key itself is not sent to the browser. */
export function toCardData(cards: PublicListingCard[]): PropertyCardData[] {
  return cards.map(({ coverKey, ...card }) => ({ ...card, coverUrl: publicImageBaseUrl(coverKey) }));
}
