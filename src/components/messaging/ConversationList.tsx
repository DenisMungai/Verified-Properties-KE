import Link from "next/link";
import { ListingImage } from "@/components/listings/ListingImage";
import { Badge } from "@/components/ui";
import type { ConversationSummary } from "@/db/queries/messaging";
import { cn } from "@/lib/cn";
import { inboxTime } from "@/lib/messaging/format";
import { conversationHref } from "@/lib/messaging/paths";
import { publicImageBaseUrl } from "@/lib/storage";
import { unreadLabel } from "@/lib/messaging/labels";

function excerptOf(conversation: ConversationSummary): string {
  if (conversation.lastExcerpt === null) return "Message removed";
  return conversation.lastFromMe ? `You: ${conversation.lastExcerpt}` : conversation.lastExcerpt;
}

function ConversationRow({ conversation, now }: { conversation: ConversationSummary; now: Date }) {
  const unread = conversation.unread > 0;
  return (
    <li>
      <Link
        href={conversationHref(conversation.id)}
        className="flex min-h-16 items-center gap-3 rounded-sm border border-line bg-white p-3 transition-colors hover:bg-canvas"
      >
        <ListingImage
          baseUrl={publicImageBaseUrl(conversation.coverKey)}
          alt=""
          sizes="56px"
          className="aspect-square size-14 shrink-0 rounded-sm"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <p className={cn("truncate text-small text-ink", unread ? "font-bold" : "font-semibold")}>{conversation.otherName}</p>
            {conversation.role === "lister" && <Badge className="px-2 py-0.5">Your listing</Badge>}
            {conversation.closed && (
              <Badge tone="warning" className="px-2 py-0.5">
                Closed
              </Badge>
            )}
          </div>
          <p className="truncate text-micro text-slate-600">{conversation.propertyTitle}</p>
          <p className={cn("truncate text-small", unread ? "font-semibold text-ink" : "text-slate-600")}>{excerptOf(conversation)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 self-start">
          <time dateTime={conversation.lastMessageAt.toISOString()} className="text-micro text-slate-600">
            {inboxTime(conversation.lastMessageAt, now)}
          </time>
          {unread && (
            <span
              aria-label={unreadLabel(conversation.unread)}
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-micro font-semibold leading-none text-white"
            >
              {conversation.unread}
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

/** The inbox rows (prompt S15 UI "Inbox"), newest activity first. */
export function ConversationList({ conversations, now }: { conversations: ConversationSummary[]; now: Date }) {
  return (
    <ul aria-label="Conversations" className="flex flex-col gap-2">
      {conversations.map((conversation) => (
        <ConversationRow key={conversation.id} conversation={conversation} now={now} />
      ))}
    </ul>
  );
}
