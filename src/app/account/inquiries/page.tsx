import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Inbox, Mail, Phone } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { listingHref } from "@/components/search/PropertyCard";
import { Badge, Button, EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { listReceived, type ReceivedInquiry } from "@/db/queries/inquiries";
import { formatNairobiDateTime } from "@/lib/format";
import { displayKenyanPhone } from "@/lib/kenya";
import { requireLister } from "@/app/account/listings/guard";
import { markInquiriesReadAction } from "./actions";

export const metadata: Metadata = { title: "Inquiries", robots: { index: false } };

function InquiryItem({ inquiry }: { inquiry: ReceivedInquiry }) {
  const unread = inquiry.readAt === null;
  const live = inquiry.propertyStatus === "published";
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4 md:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-body font-semibold text-ink">{inquiry.fullName}</p>
          <p className="text-caption text-slate-600">
            About{" "}
            {live ? (
              <Link href={listingHref(inquiry.propertySlug)} className="font-medium text-emerald-700 underline underline-offset-2">
                {inquiry.propertyTitle}
              </Link>
            ) : (
              <span className="font-medium text-ink">{inquiry.propertyTitle}</span>
            )}{" "}
            · {formatNairobiDateTime(inquiry.createdAt)}
          </p>
        </div>
        {unread && <Badge tone="info">Unread</Badge>}
      </div>
      {/* Plain text only: rendered by React, never as HTML. */}
      <p className="whitespace-pre-line break-words text-body text-slate-700">{inquiry.message}</p>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        {inquiry.phone && (
          <a href={`tel:${inquiry.phone}`} className="inline-flex min-h-control items-center gap-2 text-body-sm font-semibold text-emerald-700 hover:underline">
            <Phone aria-hidden="true" className="size-4" />
            {displayKenyanPhone(inquiry.phone)}
          </a>
        )}
        {inquiry.email && (
          <a href={`mailto:${inquiry.email}`} className="inline-flex min-h-control items-center gap-2 break-all text-body-sm font-semibold text-emerald-700 hover:underline">
            <Mail aria-hidden="true" className="size-4 shrink-0" />
            {inquiry.email}
          </a>
        )}
        {unread && (
          <form action={markInquiriesReadAction} className="ml-auto">
            <input type="hidden" name="inquiryId" value={inquiry.id} />
            <Button type="submit" variant="ghost">
              Mark as read
            </Button>
          </form>
        )}
      </div>
    </li>
  );
}

/** The lister's inbox (prompt S8 decision 11): inquiries about listings they can manage. */
async function InquiryList() {
  const user = await requireLister("/account/inquiries");
  const inquiries = await listReceived(getDb(), user.id);
  const unread = inquiries.filter((inquiry) => inquiry.readAt === null).length;

  if (inquiries.length === 0) {
    return (
      <EmptyState
        icon={<Inbox />}
        title="No inquiries yet"
        description="When buyers message you about a listing, their details appear here."
        action={
          <Link href="/account/listings" className={buttonClasses({ variant: "secondary" })}>
            Go to My listings
          </Link>
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-body-sm text-slate-600">
          {inquiries.length} {inquiries.length === 1 ? "inquiry" : "inquiries"}
          {unread > 0 ? ` · ${unread} unread` : ""}
        </p>
        {unread > 0 && (
          <form action={markInquiriesReadAction}>
            <Button type="submit" variant="secondary">
              Mark all as read
            </Button>
          </form>
        )}
      </div>
      <ul className="flex flex-col gap-3">
        {inquiries.map((inquiry) => (
          <InquiryItem key={inquiry.id} inquiry={inquiry} />
        ))}
      </ul>
    </div>
  );
}

export default function InquiriesPage() {
  return (
    <>
      <PageHeading title="Inquiries" description="Messages from buyers and tenants about your listings." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <InquiryList />
      </Suspense>
    </>
  );
}
