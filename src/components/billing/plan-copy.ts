/** Who each plan suits (plan v2.0 §1; prompt S6 decision 12). Prices and limits come from the database. */
const PLAN_AUDIENCE: Record<string, string> = {
  starter: "Private owners and new agents",
  pro: "Independent agents",
  agency: "Agencies and developers, shared across members",
};

export function planAudience(code: string): string | null {
  return PLAN_AUDIENCE[code] ?? null;
}

export function listingLimitLine(limit: number | null): string {
  if (limit === null) return "";
  return `Up to ${limit} active property ${limit === 1 ? "listing" : "listings"}`;
}

export function planTermsLine(cardsEnabled: boolean): string {
  return `Pay with M-Pesa${cardsEnabled ? " or card" : ""}. No automatic renewal.`;
}
