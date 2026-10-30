import { NAIROBI_TIME_ZONE } from "@/lib/format";

/**
 * Daraja STK request credentials (prompt S5 decision 10). Pure: callers pass the time.
 * `Timestamp` is Nairobi local time as YYYYMMDDHHmmss; `Password` is base64(shortcode + passkey +
 * timestamp).
 */

const parts = new Intl.DateTimeFormat("en-GB", {
  timeZone: NAIROBI_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export function darajaTimestamp(now: Date): string {
  const p = Object.fromEntries(parts.formatToParts(now).map((part) => [part.type, part.value]));
  return `${p.year}${p.month}${p.day}${p.hour}${p.minute}${p.second}`;
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString("base64");
}
