"use client";

import { cn } from "@/lib/cn";
import { unreadLabel } from "@/lib/messaging/labels";
import { useUnreadCount } from "./message-poller";

/**
 * Unread messages pill (prompt S15 UI "Badge"). Hidden at 0. `dot` is the small marker on the
 * mobile menu button; the count stays in its accessible label.
 */
export function UnreadBadge({ initial, variant = "count", className }: { initial: number; variant?: "count" | "dot"; className?: string }) {
  const count = useUnreadCount(initial);
  if (count <= 0) return null;
  if (variant === "dot") {
    return (
      <span role="status" className={cn("inline-block size-2.5 rounded-full bg-emerald-600 ring-2 ring-white", className)}>
        <span className="sr-only">{unreadLabel(count)}</span>
      </span>
    );
  }
  return (
    <span
      role="status"
      aria-label={unreadLabel(count)}
      className={cn("inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-micro font-semibold leading-none text-white", className)}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
