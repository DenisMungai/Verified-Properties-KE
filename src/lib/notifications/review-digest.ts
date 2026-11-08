import { HOUR_MS } from "./constants";

/** Pure helpers for the moderators' digest (prompt S16 decision 6). */

/** The Nairobi calendar date, "YYYY-MM-DD": the digest's once-a-day key. */
export function nairobiDateKey(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** "30 hours" under two days, then "3 days". */
export function waitLabel(since: Date, now: Date): string {
  const hours = Math.max(0, Math.floor((now.getTime() - since.getTime()) / HOUR_MS));
  if (hours < 48) return hours === 1 ? "1 hour" : `${hours} hours`;
  return `${Math.floor(hours / 24)} days`;
}
