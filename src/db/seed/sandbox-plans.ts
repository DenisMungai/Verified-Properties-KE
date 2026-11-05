import type { plans } from "@/db/schema";

/**
 * Placeholder SANDBOX plans (KES 1–3) for Daraja sandbox testing, shared by `npm run plans:seed`
 * and `npm run db:seed`. Real prices are added later as version 2, never by editing these rows
 * (plan terms are immutable by trigger).
 */
export const SANDBOX_PLANS: (typeof plans.$inferInsert)[] = [
  { code: "starter", version: 1, kind: "listing", name: "Starter", priceKes: 1, listingLimit: 3 },
  { code: "pro", version: 1, kind: "listing", name: "Pro", priceKes: 2, listingLimit: 20 },
  {
    code: "agency",
    version: 1,
    kind: "listing",
    name: "Agency",
    priceKes: 3,
    listingLimit: 100,
    isAgencyPlan: true,
  },
  { code: "verification", version: 1, kind: "verification", name: "Verification", priceKes: 1, listingLimit: null },
];
