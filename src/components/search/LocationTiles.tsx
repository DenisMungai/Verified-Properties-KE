import Link from "next/link";
import { MapPin } from "lucide-react";
import { cn } from "@/lib/cn";
import { searchHref } from "@/lib/search/params";

/**
 * "Explore popular locations" (no stock photos): Kenya's major cities and towns, biggest first.
 * - Phones: a 2-column grid of compact rows, first 6, so nothing scrolls sideways.
 * - sm–lg: a snap rail of icon circles with every location (touch scrolling).
 * - lg+: one row, evenly spread and never scrolled; it shows as many as fit (7 / 9 / 10 at
 *   lg / xl / 2xl), so the row is always full and no tile is cut off.
 */
const LOCATIONS = [
  { name: "Nairobi", note: "Apartments & homes" },
  { name: "Mombasa", note: "Coastal living" },
  { name: "Kisumu", note: "Lakeside city" },
  { name: "Nakuru", note: "Space to grow" },
  { name: "Eldoret", note: "Highland city" },
  { name: "Kiambu", note: "Family homes" },
  { name: "Thika", note: "Commuter town" },
  { name: "Machakos", note: "Near the capital" },
  { name: "Nyeri", note: "Central highlands" },
  { name: "Kitengela", note: "Growing suburb" },
  { name: "Naivasha", note: "Lake and leisure" },
  { name: "Malindi", note: "Coastal town" },
  { name: "Meru", note: "Mt Kenya east" },
  { name: "Nanyuki", note: "Mt Kenya views" },
] as const;

/** Hides a tile past what fits each layout (counts above); literal classes so Tailwind sees them. */
function visibilityClasses(index: number): string {
  return cn(
    index >= 6 && "max-sm:hidden",
    index >= 7 && "lg:max-xl:hidden",
    index >= 9 && "xl:max-2xl:hidden",
    index >= 10 && "2xl:hidden",
  );
}

export function LocationTiles() {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:flex sm:snap-x sm:gap-6 sm:overflow-x-auto hide-scrollbar lg:justify-between lg:overflow-visible">
      {LOCATIONS.map((location, index) => (
        <li key={location.name} className={cn("min-w-0 sm:shrink-0 sm:snap-start", visibilityClasses(index))}>
          <Link
            href={searchHref({ q: location.name })}
            className="group flex min-h-control items-center gap-3 rounded-sm border border-line bg-white p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-600 sm:w-28 sm:flex-col sm:gap-2 sm:rounded-lg sm:border-0 sm:bg-transparent sm:p-0 sm:text-center"
          >
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white text-emerald-700 transition-colors duration-200 group-hover:border-emerald-600 group-hover:bg-emerald-600 group-hover:text-white sm:size-20"
            >
              <MapPin className="size-5 sm:size-7" />
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-small font-medium text-ink group-hover:underline">{location.name}</span>
              <span className="text-micro text-slate-600">{location.note}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
