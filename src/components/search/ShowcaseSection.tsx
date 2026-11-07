import "server-only";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import type { HomeShowcase } from "@/db/queries/public-listings";
import { HOME_CARD_GRID, HOME_CARD_IMAGE_SIZES, PropertyCard } from "./PropertyCard";
import { saveProps, toCardData, type SaveContext } from "./card-data";

/** Where the home page's "How it works" links land (prompt S14 decision 6). */
export const HOW_FEATURED_WORKS_HREF = "/how-it-works#featured";

/** The subline under a section that shows featured cards: featuring is paid, and how it works. */
export function FeaturedDisclosure() {
  return (
    <>
      Featured listings come from verified listers, a paid service.{" "}
      <Link href={HOW_FEATURED_WORKS_HREF} className="font-medium text-emerald-700 underline underline-offset-4 hover:text-ink">
        How it works
      </Link>
    </>
  );
}

/**
 * One home listings section (prompt S14): heading, subline, a link to the matching search, then
 * the featured cards (labelled) followed by the newest (unlabelled) in the home card grid.
 */
export function ShowcaseSection({
  id,
  heading,
  subline,
  link,
  showcase,
  saveContext,
}: {
  id: string;
  heading: string;
  subline: ReactNode;
  link: { href: string; label: string };
  showcase: HomeShowcase;
  saveContext: SaveContext;
}) {
  const headingId = `${id}-heading`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col">
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-1">
          <h2 id={headingId} className="text-title">
            {heading}
          </h2>
          <p className="text-small text-slate-600">{subline}</p>
        </div>
        <Link
          href={link.href}
          className="inline-flex min-h-control items-center gap-1 self-start text-small font-medium text-ink underline-offset-4 hover:underline sm:self-auto"
        >
          {link.label}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
      <ul className={HOME_CARD_GRID}>
        {toCardData(showcase.featured).map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} featured save={saveProps(saveContext, listing.id)} sizes={HOME_CARD_IMAGE_SIZES} />
          </li>
        ))}
        {toCardData(showcase.newest).map((listing) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} save={saveProps(saveContext, listing.id)} sizes={HOME_CARD_IMAGE_SIZES} />
          </li>
        ))}
      </ul>
    </section>
  );
}
