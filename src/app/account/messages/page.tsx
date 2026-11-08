import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MessageSquare } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { ConversationList } from "@/components/messaging/ConversationList";
import { InboxRefresher } from "@/components/messaging/Refreshers";
import { EmptyState, Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { listConversations, unreadTotal } from "@/db/queries/messaging";
import { LISTER_ROLES, hasAnyRole } from "@/lib/roles";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Messages", robots: { index: false } };

/** Every conversation the user is in, as buyer or lister (prompt S15 decisions 2 and 10). */
async function Inbox() {
  const user = await requireUser("/account/messages");
  const db = getDb();
  const [conversations, unread] = await Promise.all([listConversations(db, user.id), unreadTotal(db, user.id)]);
  const now = new Date();

  if (conversations.length === 0) {
    const lister = hasAnyRole(user.roles, LISTER_ROLES);
    return (
      <EmptyState
        icon={<MessageSquare />}
        title="No messages yet"
        description={
          lister
            ? "When buyers message you about a listing, the conversation appears here."
            : "When you contact a lister about a property, the conversation appears here."
        }
        action={
          <Link href={lister ? "/account/listings" : "/properties"} className={buttonClasses({ variant: "secondary" })}>
            {lister ? "Go to My listings" : "Explore properties"}
          </Link>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <InboxRefresher unread={unread} />
      <p role="status" className="text-small text-slate-600">
        {conversations.length} {conversations.length === 1 ? "conversation" : "conversations"}
        {unread > 0 ? ` · ${unread} unread` : ""}
      </p>
      <ConversationList conversations={conversations} now={now} />
    </div>
  );
}

export default function MessagesPage() {
  return (
    <>
      <PageHeading title="Messages" description="Conversations with buyers, tenants and listers." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Inbox />
      </Suspense>
    </>
  );
}
