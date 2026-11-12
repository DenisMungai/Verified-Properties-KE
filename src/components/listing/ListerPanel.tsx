import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Avatar, VerifiedBadge, buttonClasses } from "@/components/ui";
import type { PublicListingDetail } from "@/db/queries/listing-detail";
import { formatKes } from "@/lib/format";
import { hasAnyContact, type ContactVisibility, type ListerContact } from "@/lib/listings/contact";
import type { ListingRef } from "@/lib/listings/contact-links";
import { LISTER_TYPE_LABELS } from "@/lib/roles";
import { RENT_SUFFIX } from "@/lib/search/card";
import { ContactButtons } from "./ContactButtons";
import { InquiryForm } from "./InquiryForm";

export type Viewer =
  | { kind: "signed_out"; signInHref: string }
  | { kind: "own" }
  | { kind: "buyer"; defaults: { fullName: string; email: string }; conversationHref: string | null };

const PRICE_LABEL = { sale: "Sale price", rent: "Rent" } as const;

/**
 * Price, lister identity, contact buttons and the inquiry form (the design's sticky right card).
 * `contact` is already filtered by the server's contact rule (prompt lister-contact-buttons).
 */
export function ListerPanel({
  listing,
  listingRef,
  avatarUrl,
  contact,
  visibility,
  viewer,
}: {
  listing: PublicListingDetail;
  /** Title and absolute URL, for the WhatsApp and Email messages. */
  listingRef: ListingRef;
  /** The lister's avatar URL (resolved on the server; the storage key is not passed down). */
  avatarUrl: string | null;
  contact: ListerContact;
  visibility: ContactVisibility;
  viewer: Viewer;
}) {
  const listerName = listing.listerName ?? "Lister";
  const contactShown = viewer.kind !== "own" && (hasAnyContact(contact.lister) || hasAnyContact(contact.agency));
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
      </div>

      {contactShown && <ContactButtons contact={contact} listerName={listerName} listing={listingRef} />}

      {viewer.kind === "buyer" &&
        (viewer.conversationHref ? (
          // Follow-ups go to the conversation (prompt S15 decision 4).
          <div className="flex flex-col gap-2">
            <Link href={viewer.conversationHref} className={buttonClasses({ size: "lg", className: "w-full" })}>
              <MessageSquare aria-hidden="true" className="size-4" />
              Message the lister
            </Link>
            <p className="text-micro text-slate-600">Your conversation about this property is in Messages.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {contactShown && (
              <p className="border-t border-line pt-4 text-small font-medium text-ink">Or send a message on VerifiedPropertiesKE</p>
            )}
            <InquiryForm listingId={listing.id} defaults={viewer.defaults} />
          </div>
        ))}
      {viewer.kind === "signed_out" &&
        (visibility === "hidden" ? (
          <div className="flex flex-col gap-2">
            <Link href={viewer.signInHref} className={buttonClasses({ size: "lg", className: "w-full" })}>
              Sign in to see contact details
            </Link>
            <p className="text-micro text-slate-600">It&apos;s free. You&apos;ll come straight back to this listing.</p>
          </div>
        ) : (
          <p className="text-small text-slate-600">
            Prefer to message on the site?{" "}
            <Link href={viewer.signInHref} className="font-semibold text-emerald-700 underline underline-offset-4">
              Sign in to send a message
            </Link>
          </p>
        ))}
      {viewer.kind === "own" && (
        <p className="rounded-md bg-mint-50 px-4 py-3 text-small text-emerald-700">
          This is your listing. Buyers&apos; messages appear in{" "}
          <Link href="/account/messages" className="font-semibold underline">
            Messages
          </Link>
          .
        </p>
      )}
    </div>
  );
}
