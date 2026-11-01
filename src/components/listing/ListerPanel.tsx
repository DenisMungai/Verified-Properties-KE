import Link from "next/link";
import { Mail, Phone } from "lucide-react";
import { Avatar, VerifiedBadge, buttonClasses } from "@/components/ui";
import type { PublicListingDetail } from "@/db/queries/listing-detail";
import { formatKes } from "@/lib/format";
import { displayKenyanPhone } from "@/lib/kenya";
import type { ContactVisibility, ListerContact } from "@/lib/listings/contact";
import { LISTER_TYPE_LABELS } from "@/lib/roles";
import { RENT_SUFFIX } from "@/lib/search/card";
import { InquiryForm } from "./InquiryForm";

export type Viewer =
  | { kind: "signed_out"; signInHref: string }
  | { kind: "own" }
  | { kind: "buyer"; defaults: { fullName: string; email: string } };

const PRICE_LABEL = { sale: "Sale price", rent: "Rent" } as const;

/** Only what the contact rule allowed reaches this component (prompt S8 decision 1). */
function ContactDetails({ contact, visibility, viewer }: { contact: ListerContact; visibility: ContactVisibility; viewer: Viewer }) {
  const shown = [
    contact.phone && (
      <a key="phone" href={`tel:${contact.phone}`} className="inline-flex min-h-control items-center gap-2 text-body font-semibold text-emerald-700 underline-offset-4 hover:underline">
        <Phone aria-hidden="true" className="size-4" />
        {displayKenyanPhone(contact.phone)}
      </a>
    ),
    contact.email && (
      <a key="email" href={`mailto:${contact.email}`} className="inline-flex min-h-control items-center gap-2 break-all text-small text-emerald-700 hover:underline">
        <Mail aria-hidden="true" className="size-4 shrink-0" />
        {contact.email}
      </a>
    ),
  ].filter(Boolean);

  if (shown.length > 0) return <div className="flex flex-col">{shown}</div>;
  if (visibility === "hidden" && viewer.kind !== "own") {
    return <p className="text-small text-slate-600">The lister&apos;s phone number appears here after you send them a message.</p>;
  }
  if (visibility === "after_inquiry") {
    return <p className="text-small text-slate-600">This lister hasn&apos;t added a phone number. They&apos;ll reply to the details you sent.</p>;
  }
  return null;
}

/** Price, lister identity, contact rule and the inquiry form (the design's sticky right card). */
export function ListerPanel({
  listing,
  avatarUrl,
  contact,
  visibility,
  viewer,
}: {
  listing: PublicListingDetail;
  /** The lister's avatar URL (resolved on the server; the storage key is not passed down). */
  avatarUrl: string | null;
  contact: ListerContact;
  visibility: ContactVisibility;
  viewer: Viewer;
}) {
  return (
    <div id="contact" className="flex scroll-mt-24 flex-col gap-5 rounded-xl border border-line bg-white p-5 md:p-6">
      <div className="flex flex-col gap-1 border-b border-line pb-5">
        <p className="tabular text-display-sm text-ink">
          {formatKes(listing.priceKes)}
          {listing.rentPeriod && <span className="text-title font-semibold tracking-normal"> {RENT_SUFFIX[listing.rentPeriod]}</span>}
        </p>
        <p className="text-micro text-slate-600">{PRICE_LABEL[listing.listingType]} · Ask about viewing availability</p>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <Avatar name={listing.listerName ?? "Lister"} baseUrl={avatarUrl} size="md" />
          <div className="flex min-w-0 flex-col">
            <h2 className="text-title">{listing.listerName ?? "Lister"}</h2>
            {listing.verified ? (
              <VerifiedBadge className="self-start bg-transparent px-0 py-0 text-emerald-700" />
            ) : (
              listing.listerType && <p className="text-micro text-slate-600">{LISTER_TYPE_LABELS[listing.listerType]}</p>
            )}
          </div>
        </div>
        <ContactDetails contact={contact} visibility={visibility} viewer={viewer} />
      </div>

      {viewer.kind === "buyer" && <InquiryForm listingId={listing.id} defaults={viewer.defaults} />}
      {viewer.kind === "signed_out" && (
        <div className="flex flex-col gap-2">
          <Link href={viewer.signInHref} className={buttonClasses({ size: "lg", className: "w-full" })}>
            Sign in to contact this lister
          </Link>
          <p className="text-micro text-slate-600">It&apos;s free. You&apos;ll come straight back to this listing.</p>
        </div>
      )}
      {viewer.kind === "own" && (
        <p className="rounded-md bg-mint-50 px-4 py-3 text-small text-emerald-700">
          This is your listing. Buyers&apos; messages appear in{" "}
          <Link href="/account/inquiries" className="font-semibold underline">
            Inquiries
          </Link>
          .
        </p>
      )}
    </div>
  );
}
