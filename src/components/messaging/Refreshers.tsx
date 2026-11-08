"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useUnreadCount, useWatchedConversation } from "./message-poller";

/**
 * Open thread: re-renders the page on the server when the poll sees a newer message than the one
 * this render shows. The reply box is uncontrolled, so a refresh keeps what is being typed.
 */
export function ThreadRefresher({ conversationId, lastMessageAt }: { conversationId: string; lastMessageAt: string }) {
  const router = useRouter();
  const latest = useWatchedConversation(conversationId);
  useEffect(() => {
    if (latest && Date.parse(latest) > Date.parse(lastMessageAt)) router.refresh();
  }, [latest, lastMessageAt, router]);
  return null;
}

/** Inbox: re-renders when the polled unread total differs from the one this render counted. */
export function InboxRefresher({ unread }: { unread: number }) {
  const router = useRouter();
  const polled = useUnreadCount(unread);
  useEffect(() => {
    if (polled !== unread) router.refresh();
  }, [polled, unread, router]);
  return null;
}
