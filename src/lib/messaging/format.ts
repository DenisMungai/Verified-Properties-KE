import { NAIROBI_TIME_ZONE, formatNairobiDate } from "@/lib/format";
import { nairobiDay } from "@/lib/stats/engagement";

/**
 * Message times in Nairobi (prompt S15 UI). Pure functions of the dates passed in, so the
 * server render is deterministic for a given `now`.
 */

const timeFormatter = new Intl.DateTimeFormat("en-KE", {
  timeZone: NAIROBI_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** "14:05" in Nairobi time. */
export function formatNairobiTime(date: Date): string {
  return timeFormatter.format(date);
}

/** Inbox time: the time for today, otherwise the date. */
export function inboxTime(date: Date, now: Date): string {
  return nairobiDay(date) === nairobiDay(now) ? formatNairobiTime(date) : formatNairobiDate(date);
}

/** Thread day separator: "Today", "Yesterday" or the date. */
export function dayLabel(date: Date, now: Date): string {
  const day = nairobiDay(date);
  if (day === nairobiDay(now)) return "Today";
  if (day === nairobiDay(new Date(now.getTime() - DAY_MS))) return "Yesterday";
  return formatNairobiDate(date);
}
