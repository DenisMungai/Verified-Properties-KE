import Link from "next/link";
import { MapPin } from "lucide-react";
import { searchHref } from "@/lib/search/params";

/**
 * "Explore popular locations" (no stock photos). Phones: a 2×2 grid of compact rows so every
 * location shows without sideways scrolling. From sm: a rail of icon circles.
 */
const LOCATIONS = [
  { county: "Nairobi", note: "Apartments & homes" },
  { county: "Kiambu", note: "Family homes" },
  { county: "Mombasa", note: "Coastal living" },
  { county: "Nakuru", note: "Space to grow" },
] as const;

export function LocationTiles() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:flex sm:snap-x sm:gap-6 sm:overflow-x-auto hide-scrollbar">
      {LOCATIONS.map((location) => (
        <li key={location.county} className="min-w-0 sm:shrink-0 sm:snap-start">
          <Link
            href={searchHref({ q: location.county })}
            className="group flex min-h-control items-center gap-3 rounded-sm border border-line bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 sm:w-28 sm:flex-col sm:gap-2 sm:rounded-lg sm:border-0 sm:bg-transparent sm:p-0 sm:text-center"
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-emerald-700 transition-colors duration-200 group-hover:border-emerald-600 group-hover:bg-emerald-600 group-hover:text-white sm:size-20"
            >
              <MapPin className="size-5 sm:size-7" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-small font-medium text-ink group-hover:underline">{location.county}</span>
              <span className="text-micro text-slate-600">{location.note}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
