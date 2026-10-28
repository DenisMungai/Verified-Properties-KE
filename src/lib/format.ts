/**
 * Display formatting for Kenya. Money is whole shillings (integers) everywhere; timestamps are
 * stored in UTC and shown in Nairobi time.
 */

export const NAIROBI_TIME_ZONE = "Africa/Nairobi";

const kesFormatter = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

function assertWholeShillings(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new RangeError(`Expected a non-negative whole-shilling amount, got ${amount}`);
  }
}

/** 45000000 -> "KSh 45,000,000" */
export function formatKes(amount: number): string {
  assertWholeShillings(amount);
  return `KSh ${kesFormatter.format(amount)}`;
}

/** Short form for cards: 45000000 -> "KSh 45M", 850000 -> "KSh 850K", 9500 -> "KSh 9,500". */
export function formatKesCompact(amount: number): string {
  assertWholeShillings(amount);
  if (amount < 100_000) return formatKes(amount);
  const units: Array<[number, string]> = [
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [size, suffix] of units) {
    if (amount >= size) {
      const value = Math.round((amount / size) * 10) / 10;
      return `KSh ${value.toLocaleString("en-KE", { maximumFractionDigits: 1 })}${suffix}`;
    }
  }
  return formatKes(amount);
}

const dateFormatter = new Intl.DateTimeFormat("en-KE", {
  timeZone: NAIROBI_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-KE", {
  timeZone: NAIROBI_TIME_ZONE,
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** "28 Oct 2026" in Nairobi time. */
export function formatNairobiDate(date: Date): string {
  return dateFormatter.format(date);
}

/** "28 Oct 2026, 14:05" in Nairobi time (24-hour). */
export function formatNairobiDateTime(date: Date): string {
  return dateTimeFormatter.format(date);
}

export type LandSizeUnit = "sqm" | "acre" | "hectare";

const LAND_UNIT_LABEL: Record<LandSizeUnit, [singular: string, plural: string]> = {
  sqm: ["m²", "m²"],
  acre: ["acre", "acres"],
  hectare: ["hectare", "hectares"],
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-KE", { maximumFractionDigits: 2 });
}

/** Built area is always square metres: 120 -> "120 m²". */
export function formatAreaSqm(sqm: number): string {
  return `${formatNumber(sqm)} m²`;
}

/** Land size always carries its unit: (0.5, "acre") -> "0.5 acres", (1, "acre") -> "1 acre". */
export function formatLandSize(size: number, unit: LandSizeUnit): string {
  const [singular, plural] = LAND_UNIT_LABEL[unit];
  return `${formatNumber(size)} ${size === 1 ? singular : plural}`;
}
