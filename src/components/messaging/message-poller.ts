"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * One shared poll of `GET /api/messages/status` (prompt S15 decision 14) for every badge and the
 * open thread on the page: every 15 s while the tab is visible, at once when it becomes visible
 * again, and paused after 3 straight failures until the next visibility change.
 */

export const POLL_INTERVAL_MS = 15_000;
const MAX_FAILURES = 3;

interface PollState {
  unread: number | null;
  lastMessageAt: string | null;
}

let state: PollState = { unread: null, lastMessageAt: null };
const listeners = new Set<() => void>();
let watched: string | null = null;
let timer: ReturnType<typeof setInterval> | undefined;
let failures = 0;
let inFlight = false;

function update(next: Partial<PollState>): void {
  const merged = { ...state, ...next };
  if (merged.unread === state.unread && merged.lastMessageAt === state.lastMessageAt) return;
  state = merged;
  for (const listener of listeners) listener();
}

async function poll(): Promise<void> {
  if (inFlight || failures >= MAX_FAILURES || document.visibilityState !== "visible") return;
  inFlight = true;
  const asked = watched;
  try {
    const query = asked ? `?conversation=${encodeURIComponent(asked)}` : "";
    const response = await fetch(`/api/messages/status${query}`, { cache: "no-store", credentials: "same-origin" });
    if (response.status === 429) return;
    if (!response.ok) {
      failures += 1;
      return;
    }
    const data = (await response.json()) as { unread?: unknown; lastMessageAt?: unknown };
    failures = 0;
    update({
      unread: typeof data.unread === "number" ? data.unread : state.unread,
      // Ignore an answer about a conversation the page has since left.
      lastMessageAt: asked === watched && typeof data.lastMessageAt === "string" ? data.lastMessageAt : state.lastMessageAt,
    });
  } catch {
    failures += 1;
  } finally {
    inFlight = false;
  }
}

function onVisibilityChange(): void {
  if (document.visibilityState !== "visible") return;
  failures = 0;
  void poll();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      clearInterval(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    }
  };
}

const unreadSnapshot = () => state.unread;
const lastMessageSnapshot = () => state.lastMessageAt;
const serverSnapshot = () => null;

/**
 * The unread total: the server-rendered count until a poll answers. A newer server render (after
 * reading a thread, say) replaces the polled value straight away.
 */
export function useUnreadCount(initial: number): number {
  const polled = useSyncExternalStore(subscribe, unreadSnapshot, serverSnapshot);
  useEffect(() => {
    update({ unread: initial });
  }, [initial]);
  return polled ?? initial;
}

/** The open conversation's last activity, as last polled (null until a poll answers). */
export function useWatchedConversation(conversationId: string): string | null {
  const latest = useSyncExternalStore(subscribe, lastMessageSnapshot, serverSnapshot);
  useEffect(() => {
    watched = conversationId;
    update({ lastMessageAt: null });
    return () => {
      if (watched === conversationId) watched = null;
    };
  }, [conversationId]);
  return latest;
}
