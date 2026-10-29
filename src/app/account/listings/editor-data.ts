import "server-only";
import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getListingPlanUsage } from "@/db/queries/billing";
import { getManageableListing, type EditableListing } from "@/db/queries/listings";
import type { BasicsDefaults } from "@/components/listings/BasicsForm";
import type { DetailsDefaults } from "@/components/listings/DetailsForm";
import { requireLister } from "./guard";

/** The listing the signed-in lister may manage, or a 404 (unknown, malformed or not theirs). */
export async function loadEditableListing(params: Promise<{ id: string }>, step: string) {
  const { id } = await params;
  const user = await requireLister(`/account/listings/${id}/${step}`);
  const db = getDb();
  const listing = await getManageableListing(db, user.id, id);
  if (!listing) notFound();
  const usage = await getListingPlanUsage(db, listing.ownerUserId);
  return { user, listing, usage };
}

export function editorHeading(listing: EditableListing | null): { title: string; description: string } {
  if (!listing || listing.status === "draft") {
    return {
      title: "Create a property listing",
      description: "Add accurate details so buyers and tenants can make informed decisions.",
    };
  }
  return { title: "Edit listing", description: listing.title };
}

const str = (value: number | string | null) => (value === null ? "" : String(value));

export const EMPTY_BASICS: BasicsDefaults = {
  title: "",
  listingType: "sale",
  category: "",
  county: "",
  town: "",
  neighbourhood: "",
  priceKes: "",
  rentPeriod: "month",
  bedrooms: "",
};

export function basicsDefaults(listing: EditableListing): BasicsDefaults {
  return {
    title: listing.title,
    listingType: listing.listingType,
    category: listing.category,
    county: listing.county,
    town: listing.town,
    neighbourhood: str(listing.neighbourhood),
    priceKes: listing.priceKes.toLocaleString("en-KE"),
    rentPeriod: listing.rentPeriod ?? "month",
    bedrooms: str(listing.bedrooms),
  };
}

export function detailsDefaults(listing: EditableListing): DetailsDefaults {
  return {
    description: listing.description,
    bathrooms: str(listing.bathrooms),
    areaSqm: str(listing.areaSqm),
    landSize: str(listing.landSize),
    landSizeUnit: listing.landSizeUnit ?? "",
    furnished: listing.furnished ? "1" : "",
    parkingSpaces: str(listing.parkingSpaces),
    amenities: listing.amenities.join("|"),
    subtype: listing.subtype ?? "",
    zoningNotes: listing.zoningNotes ?? "",
  };
}
