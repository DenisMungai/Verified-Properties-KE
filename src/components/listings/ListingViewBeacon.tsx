"use client";

import { useEffect } from "react";
import { recordListingViewAction } from "@/app/properties/actions";

/**
 * Counts a property view once the page has really opened in a browser (prompt S13 decision 12):
 * prefetches, server renders and most bots never run effects. Renders nothing.
 */
export function ListingViewBeacon({ listingId }: { listingId: string }) {
  useEffect(() => {
    void recordListingViewAction(listingId).catch(() => {});
  }, [listingId]);
  return null;
}
