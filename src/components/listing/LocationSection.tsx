import Link from "next/link";
import { ExternalLink, Map as MapIcon, MapPin } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { isGoogleMapsUrl } from "@/lib/listings/map-link";

/**
 * "Location" on the listing page (prompt google-map-links). The map link follows the contact rule:
 * the server passes `mapUrl` only when this viewer may see it, and `signInHref` when a link exists
 * but is hidden. Neither is set when the lister gave no link.
 */
export function LocationSection({
  place,
  mapUrl,
  signInHref,
}: {
  place: string;
  mapUrl: string | null;
  signInHref: string | null;
}) {
  const link = isGoogleMapsUrl(mapUrl) ? mapUrl : null;
  return (
    <section aria-labelledby="location-heading" className="flex flex-col gap-3">
      <h2 id="location-heading" className="text-title">
        Location
      </h2>
      <p className="flex items-start gap-2 text-small text-slate-700">
        <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {place}
      </p>
      {link ? (
        <div className="flex flex-col gap-1.5">
          <a
            href={link}
            target="_blank"
            rel="nofollow ugc noopener noreferrer"
            className={buttonClasses({ variant: "secondary", className: "w-full sm:w-auto sm:self-start" })}
          >
            <MapIcon aria-hidden="true" className="size-4" />
            View on Google Maps
            <ExternalLink aria-hidden="true" className="size-4" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
          <p className="text-micro text-slate-600">Location link provided by the lister.</p>
        </div>
      ) : (
        signInHref && (
          <Link
            href={signInHref}
            className="inline-flex min-h-control items-center self-start text-small font-semibold text-emerald-700 underline-offset-4 hover:underline"
          >
            Sign in to see the map location
          </Link>
        )
      )}
    </section>
  );
}
