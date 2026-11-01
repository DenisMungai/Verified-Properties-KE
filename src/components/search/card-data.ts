import "server-only";
import { getDb } from "@/db";
import { savedIdsAmong } from "@/db/queries/favorites";
import type { PublicListingCard } from "@/db/queries/public-listings";
import { signInPath } from "@/lib/safe-redirect";
import { getCurrentUser } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";
import type { SaveButtonProps } from "@/components/listing/SaveButton";
import type { PropertyCardData } from "./PropertyCard";

/** Resolves each cover and avatar to its public URL; storage keys are not sent to the browser. */
export function toCardData(cards: PublicListingCard[]): PropertyCardData[] {
  return cards.map(({ coverKey, listerAvatarKey, ...card }) => ({
    ...card,
    coverUrl: publicImageBaseUrl(coverKey),
    listerAvatarUrl: publicImageBaseUrl(listerAvatarKey),
  }));
}

/** How hearts render for this viewer: saved state when signed in, a sign-in link otherwise. */
export interface SaveContext {
  signedIn: boolean;
  savedIds: Set<string>;
  signInHref: string;
}

/**
 * One query for the saved state of every listing on screen (prompt S8 decision 6). `returnTo` is
 * where sign-in should come back to. Reads the session, so callers sit inside <Suspense>.
 */
export async function saveContextFor(listingIds: string[], returnTo: string): Promise<SaveContext> {
  const user = await getCurrentUser();
  const signedIn = Boolean(user?.emailVerified);
  const savedIds = signedIn ? await savedIdsAmong(getDb(), user!.id, listingIds) : new Set<string>();
  return { signedIn, savedIds, signInHref: signInPath(returnTo) };
}

export function saveProps(context: SaveContext, listingId: string, refreshAfter = false): SaveButtonProps {
  return context.signedIn
    ? { listingId, saved: context.savedIds.has(listingId), refreshAfter }
    : { signInHref: context.signInHref };
}
