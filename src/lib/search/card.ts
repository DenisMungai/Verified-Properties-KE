import { formatAreaSqm, formatLandSize, type LandSizeUnit } from "@/lib/format";
import { CATEGORY_LABELS, type Category, type RentPeriod } from "@/lib/validation/listing";

/** The fields a public property card shows (prompt S7 decision 10). */
export interface CardFactsInput {
  category: Category;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqm: number | null;
  landSize: number | null;
  landSizeUnit: LandSizeUnit | null;
  parkingSpaces: number | null;
}

function count(n: number, singular: string, plural: string): string {
  return `${n.toLocaleString("en-KE", { maximumFractionDigits: 1 })} ${n === 1 ? singular : plural}`;
}

/** "3 beds · 2 baths · 1 parking" for homes, the land size for land, the floor area for commercial. */
export function cardFacts(card: CardFactsInput): string[] {
  if (card.category === "land") {
    return card.landSize !== null && card.landSizeUnit ? [formatLandSize(card.landSize, card.landSizeUnit)] : [];
  }
  if (card.category === "commercial") {
    const facts = card.areaSqm !== null ? [formatAreaSqm(card.areaSqm)] : [];
    if (card.parkingSpaces) facts.push(count(card.parkingSpaces, "parking", "parking"));
    return facts;
  }
  const facts: string[] = [];
  if (card.bedrooms !== null) facts.push(card.bedrooms === 0 ? "Studio" : count(card.bedrooms, "bed", "beds"));
  if (card.bathrooms !== null) facts.push(count(card.bathrooms, "bath", "baths"));
  if (card.parkingSpaces) facts.push(count(card.parkingSpaces, "parking", "parking"));
  return facts;
}

export const RENT_SUFFIX: Record<RentPeriod, string> = { week: "/ week", month: "/ month", year: "/ year" };

/** Cover alt text, or "Apartment in Nairobi" when the cover has none. */
export function cardImageAlt(card: { coverAlt: string | null; category: Category; town: string }): string {
  return card.coverAlt?.trim() || `${CATEGORY_LABELS[card.category]} in ${card.town}`;
}
