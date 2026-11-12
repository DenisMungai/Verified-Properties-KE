import Link from "next/link";
import { Avatar } from "@/components/ui";

/**
 * One agency in the directory (prompt S24 decision 4): logo or initials, name and its number of
 * published listings. The whole card is one link to the agency's page. No badge: verification is
 * per person.
 */
export function AgencyDirectoryCard({
  name,
  slug,
  logoUrl,
  listingCount,
}: {
  name: string;
  slug: string;
  logoUrl: string | null;
  listingCount: number;
}) {
  const listings = `${listingCount} ${listingCount === 1 ? "listing" : "listings"}`;
  return (
    <Link
      href={`/agencies/${slug}`}
      className="flex min-h-control w-full items-center gap-3 rounded-sm border border-line bg-white p-3 transition-colors hover:border-line-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
    >
      <Avatar name={name} baseUrl={logoUrl} size="md" className="shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-small font-semibold text-ink">{name}</span>
        <span className="tabular text-micro text-slate-600">{listings}</span>
      </span>
    </Link>
  );
}
