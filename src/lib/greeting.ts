import { NAIROBI_TIME_ZONE } from "@/lib/format";

const hourFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: NAIROBI_TIME_ZONE,
  hour: "numeric",
  hourCycle: "h23",
});

/** "Good morning" / "Good afternoon" / "Good evening" by the hour in Nairobi. */
export function greetingFor(date: Date): string {
  const hour = Number(hourFormatter.format(date));
  if (hour >= 5 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}
