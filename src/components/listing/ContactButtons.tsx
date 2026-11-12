import { Mail, MessageCircle, Phone } from "lucide-react";
import { buttonClasses } from "@/components/ui";
import { cn } from "@/lib/cn";
import { displayKenyanPhone } from "@/lib/kenya";
import { hasAnyContact, type ContactPoint, type ListerContact } from "@/lib/listings/contact";
import { mailtoHref, telHref, whatsappHref, type ListingRef } from "@/lib/listings/contact-links";

/**
 * Call, WhatsApp and Email buttons (prompt lister-contact-buttons decisions 4, 5 and 10). Plain
 * links, no client JavaScript. Only contacts the server's contact rule allowed reach this component.
 */

const EXTERNAL = { target: "_blank", rel: "noopener noreferrer nofollow" } as const;

function ContactRow({ point, who, listing }: { point: ContactPoint; who: string; listing: ListingRef }) {
  const tel = point.phone ? telHref(point.phone) : null;
  const chat = point.whatsapp ? whatsappHref(point.whatsapp, listing) : null;
  const button = "min-w-0 flex-1 basis-28";
  const numbers = [
    point.phone && `Phone ${displayKenyanPhone(point.phone)}`,
    point.whatsapp && point.whatsapp !== point.phone && `WhatsApp ${displayKenyanPhone(point.whatsapp)}`,
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {tel && (
          <a href={tel} className={buttonClasses({ className: button })}>
            <Phone aria-hidden="true" className="size-4 shrink-0" />
            Call<span className="sr-only"> {who}</span>
          </a>
        )}
        {chat && (
          <a href={chat} {...EXTERNAL} className={buttonClasses({ variant: "secondary", className: button })}>
            <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
            WhatsApp<span className="sr-only"> {who} (opens WhatsApp)</span>
          </a>
        )}
        {point.email && (
          <a href={mailtoHref(point.email, listing)} className={buttonClasses({ variant: "secondary", className: button })}>
            <Mail aria-hidden="true" className="size-4 shrink-0" />
            Email<span className="sr-only"> {who}</span>
          </a>
        )}
      </div>
      {(numbers.length > 0 || point.email) && (
        <p className="flex flex-col text-small text-slate-600">
          {numbers.map((line) => (
            <span key={line as string} className="tabular">
              {line}
            </span>
          ))}
          {point.email && <span className="break-all">{point.email}</span>}
        </p>
      )}
    </div>
  );
}

export function ContactButtons({
  contact,
  listerName,
  listing,
  className,
}: {
  contact: ListerContact;
  listerName: string;
  listing: ListingRef;
  className?: string;
}) {
  const showLister = hasAnyContact(contact.lister);
  const agency = hasAnyContact(contact.agency) ? contact.agency : null;
  if (!showLister && !agency) return null;

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      {showLister && <ContactRow point={contact.lister} who={listerName} listing={listing} />}
      {agency && (
        <div className={cn("flex flex-col gap-2", showLister && "border-t border-line pt-4")}>
          <p className="text-micro text-slate-600">
            Agency office · <span className="font-semibold text-ink">{agency.name}</span>
          </p>
          <ContactRow point={agency} who={`${agency.name} office`} listing={listing} />
        </div>
      )}
    </div>
  );
}

/** The mobile bottom bar's Call and WhatsApp buttons; labels collapse to icons below 360px. */
export function ContactBarButtons({ point, who, listing }: { point: ContactPoint; who: string; listing: ListingRef }) {
  const tel = point.phone ? telHref(point.phone) : null;
  const chat = point.whatsapp ? whatsappHref(point.whatsapp, listing) : null;
  if (!tel && !chat) return null;
  const label = "sr-only min-[360px]:not-sr-only";
  return (
    <div className="flex shrink-0 gap-2">
      {tel && (
        <a href={tel} className={buttonClasses({ className: "px-3" })}>
          <Phone aria-hidden="true" className="size-4 shrink-0" />
          <span className={label}>Call</span>
          <span className="sr-only"> {who}</span>
        </a>
      )}
      {chat && (
        <a href={chat} {...EXTERNAL} className={buttonClasses({ variant: "secondary", className: "px-3" })}>
          <MessageCircle aria-hidden="true" className="size-4 shrink-0" />
          <span className={label}>WhatsApp</span>
          <span className="sr-only"> {who} (opens WhatsApp)</span>
        </a>
      )}
    </div>
  );
}
