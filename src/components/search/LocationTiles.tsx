import Link from "next/link";
import { MapPin } from "lucide-react";
import { searchHref } from "@/lib/search/params";

/** "Explore popular locations" as a compact rail of icon circles (no stock photos). */
const LOCATIONS = [
  { county: "Nairobi", note: "Apartments & homes" },
  { county: "Kiambu", note: "Family homes" },
  { county: "Mombasa", note: "Coastal living" },
  { county: "Nakuru", note: "Space to grow" },
] as const;

export function LocationTiles() {
  return (
    <ul className="hide-scrollbar -mx-4 flex snap-x gap-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      {LOCATIONS.map((location) => (
        <li key={location.county} className="shrink-0 snap-start">
          <Link
            href={searchHref({ q: location.county })}
            className="group flex w-28 flex-col items-center gap-2 rounded-lg text-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600"
          >
            <span
              aria-hidden="true"
              className="flex size-20 items-center justify-center rounded-full border border-line bg-white text-emerald-700 transition-colors duration-200 group-hover:border-emerald-600 group-hover:bg-emerald-600 group-hover:text-white"
            >
              <MapPin className="size-7" />
            </span>
            <span className="flex flex-col">
              <span className="text-small font-medium text-ink group-hover:underline">{location.county}</span>
              <span className="text-micro text-slate-600">{location.note}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
