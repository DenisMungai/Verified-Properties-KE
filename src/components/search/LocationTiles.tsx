import Link from "next/link";
import { cn } from "@/lib/cn";
import { searchHref } from "@/lib/search/params";

/** Design "Explore popular locations": Soft green and warm placeholder blocks, no stock photos. */
const LOCATIONS = [
  { county: "Nairobi", note: "Apartments & homes", tone: "bg-mint-100" },
  { county: "Kiambu", note: "Family homes", tone: "bg-sand-500" },
  { county: "Mombasa", note: "Coastal living", tone: "bg-[#E6DDD2]" },
  { county: "Nakuru", note: "Space to grow", tone: "bg-mint-100" },
] as const;

export function LocationTiles() {
  return (
    <ul className="grid grid-cols-2 gap-4 lg:grid-cols-4 lg:gap-6">
      {LOCATIONS.map((location) => (
        <li key={location.county}>
          <Link
            href={searchHref({ q: location.county })}
            className="group flex flex-col gap-3 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
          >
            <span aria-hidden="true" className={cn("block h-24 rounded-lg transition-opacity group-hover:opacity-80 md:h-32", location.tone)} />
            <span className="flex flex-col">
              <span className="text-h4 text-ink group-hover:underline">{location.county}</span>
              <span className="text-caption text-slate-600">{location.note}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
