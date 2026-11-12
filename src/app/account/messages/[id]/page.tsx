import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArrowLeft, Mail, Phone } from "lucide-react";
import { ContactButtons } from "@/components/listing/ContactButtons";
import { FormAlert } from "@/components/forms/FormAlert";
import { BlockControls, UnblockButton } from "@/components/messaging/BlockControls";
import { MessageBubble, MessageThread } from "@/components/messaging/MessageThread";
import { ThreadRefresher } from "@/components/messaging/Refreshers";
import { ReplyForm } from "@/components/messaging/ReplyForm";
import { ReportMessageForm } from "@/components/messaging/ReportMessageForm";
import { ScrollToLatest } from "@/components/messaging/ScrollToLatest";
import { listingHref } from "@/components/search/PropertyCard";
import { Avatar, Skeleton, VerifiedBadge } from "@/components/ui";
import { getDb } from "@/db";
import { getListingContact } from "@/db/queries/inquiries";
import { buyerContactFor, getThread, markThreadRead, type Thread } from "@/db/queries/messaging";
import { displayKenyanPhone } from "@/lib/kenya";
import { getServerEnv } from "@/lib/env";
import { contactVisibility, visibleContact, type ListerContact } from "@/lib/listings/contact";
import { requireUser } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";

export const metadata: Metadata = { title: "Conversation", robots: { index: false } };

type Params = Promise<{ id: string }>;
type Search = Promise<Record<string, string | string[] | undefined>>;

/** The buyer's details from their latest inquiry, shown to the lister. */
interface BuyerContact {
  phone: string | null;
  email: string | null;
}

function BuyerContactLinks({ contact }: { contact: BuyerContact }) {
  if (!contact.phone && !contact.email) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-5">
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className="inline-flex min-h-control items-center gap-2 text-small font-semibold text-emerald-700 hover:underline">
          <Phone aria-hidden="true" className="size-4" />
          {displayKenyanPhone(contact.phone)}
        </a>
      )}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className="inline-flex min-h-control items-center gap-2 break-all text-small font-semibold text-emerald-700 hover:underline">
          <Mail aria-hidden="true" className="size-4 shrink-0" />
          {contact.email}
        </a>
      )}
    </div>
  );
}

type ThreadContact = { kind: "buyer"; contact: BuyerContact } | { kind: "lister"; contact: ListerContact };

/**
 * Lister: the buyer's details from their latest inquiry. Buyer: the listing's contacts under the
 * contact rule (prompt lister-contact-buttons). Being here means signed in with a verified email.
 */
async function contactFor(thread: Thread): Promise<ThreadContact> {
  const db = getDb();
  if (thread.role === "lister") return { kind: "buyer", contact: await buyerContactFor(db, thread.buyerUserId, thread.propertyId) };
  const visibility = contactVisibility({ listerVerified: thread.listerVerified, viewerSignedIn: true });
  return { kind: "lister", contact: visibleContact(await getListingContact(db, thread.propertyId), visibility) };
}

function ThreadHeader({ thread, contact }: { thread: Thread; contact: ThreadContact }) {
  const live = thread.propertyStatus === "published";
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-line bg-white p-4 md:p-5">
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex items-center gap-3">
          <Avatar name={thread.otherName} baseUrl={publicImageBaseUrl(thread.otherAvatarKey)} size="md" />
          <div className="flex min-w-0 flex-col">
            <h1 className="truncate text-title">{thread.otherName}</h1>
            {thread.role === "buyer" && thread.listerVerified && <VerifiedBadge className="self-start bg-transparent px-0 py-0 text-emerald-700" />}
          </div>
        </div>
        <p className="text-small text-slate-600">
          About{" "}
          {live ? (
            <Link href={listingHref(thread.propertySlug)} className="font-medium text-emerald-700 underline underline-offset-4">
              {thread.propertyTitle}
            </Link>
          ) : (
            <span className="font-medium text-ink">{thread.propertyTitle}</span>
          )}
        </p>
        {contact.kind === "buyer" ? (
          <BuyerContactLinks contact={contact.contact} />
        ) : (
          <ContactButtons
            contact={contact.contact}
            listerName={thread.otherName}
            listing={{ title: thread.propertyTitle, url: new URL(listingHref(thread.propertySlug), getServerEnv().NEXT_PUBLIC_APP_URL).toString() }}
            className="mt-1"
          />
        )}
      </div>
      {!thread.closed && <BlockControls conversationId={thread.id} name={thread.otherName} blockedByMe={thread.blockedByMe} />}
    </div>
  );
}

/** What replaces the reply box when sending is stopped (prompt S15 decisions 11 and 13). */
function SendingStopped({ thread }: { thread: Thread }) {
  const note = "rounded-md bg-mint-50 p-3 text-small text-ink";
  if (thread.closed) return <p className={note}>This conversation was closed by VerifiedPropertiesKE.</p>;
  if (thread.blockedByMe) {
    return (
      <div className={`${note} flex flex-wrap items-center justify-between gap-3`}>
        <p>You blocked this person. Neither of you can send messages.</p>
        <UnblockButton conversationId={thread.id} variant="ghost" />
      </div>
    );
  }
  return <p className={note}>You can&apos;t reply to this conversation.</p>;
}

async function Conversation({ params, searchParams }: { params: Params; searchParams: Search }) {
  const [{ id }, search] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/account/messages/${id}`);
  const db = getDb();
  // Mark first, so this render's unread counts already exclude what the user is reading.
  await markThreadRead(db, user.id, id);
  const thread = await getThread(db, user.id, id);
  if (!thread) notFound();
  const contact = await contactFor(thread);
  const now = new Date();
  const latest = thread.messages.at(-1) ?? null;
  const canSend = !thread.closed && !thread.blockedByMe && !thread.blockedByOther;

  return (
    <div className="flex flex-col gap-4">
      <ThreadRefresher conversationId={thread.id} lastMessageAt={(latest?.createdAt ?? now).toISOString()} />
      <ScrollToLatest latestId={latest?.id ?? null} />
      <ThreadHeader thread={thread} contact={contact} />
      {search.sent === "1" && <FormAlert state={{ message: "Message sent. The lister's reply will appear here." }} />}
      <MessageThread
        messages={thread.messages}
        now={now}
        renderMessage={(message) => (
          <MessageBubble
            message={message}
            footer={message.mine || message.body === null ? null : <ReportMessageForm messageId={message.id} reported={message.reportedByMe} />}
          />
        )}
      />
      {canSend ? <ReplyForm conversationId={thread.id} /> : <SendingStopped thread={thread} />}
    </div>
  );
}

function ThreadSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading conversation…</span>
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-16 w-2/3" />
      <Skeleton className="h-16 w-1/2 self-end" />
    </div>
  );
}

/** One conversation (prompt S15 UI "Thread"). Participants only; anyone else gets a 404. */
export default function ConversationPage({ params, searchParams }: { params: Params; searchParams: Search }) {
  return (
    <div className="flex max-w-3xl flex-col gap-3">
      <Link href="/account/messages" className="inline-flex min-h-control items-center gap-2 self-start text-small font-medium text-slate-700 hover:text-ink">
        <ArrowLeft aria-hidden="true" className="size-4" />
        Messages
      </Link>
      <Suspense fallback={<ThreadSkeleton />}>
        <Conversation params={params} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
