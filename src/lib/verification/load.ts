import "server-only";
import type { DbExecutor } from "@/db/executor";
import { getActivePlans, getListingPool, getListingSubscription, isListerVerified } from "@/db/queries/billing";
import { auditTrail, getLatestRequest, getListerContext, listDocuments, type ListerContext } from "@/db/queries/verification";
import { subscriptionPhase } from "@/lib/billing/periods";
import { loadRereviewState } from "./rereview";
import { canStartRereview, requiredDocumentTypes, type DocumentType } from "./rules";
import { listerView, type CreditFact, type ListerView } from "./view";

/** Documents as the lister sees them: no storage keys, never a download link. */
export interface ListerDocument {
  id: string;
  documentType: string;
  fileName: string;
  sizeBytes: number;
  contentType: string;
}

export interface ListerVerification {
  context: ListerContext;
  view: ListerView;
  required: DocumentType[];
  documents: ListerDocument[];
  verificationPlan: { code: string; priceKes: number } | null;
}

/** Everything the lister's verification page and billing card need, read for `userId` only. */
export async function loadListerVerification(db: DbExecutor, userId: string, now: Date): Promise<ListerVerification | null> {
  const context = await getListerContext(db, userId);
  if (!context) return null;
  const [latest, listing, badgeLive, plans] = await Promise.all([
    getLatestRequest(db, userId),
    getListingSubscription(db, await getListingPool(db, userId), now),
    isListerVerified(db, userId),
    getActivePlans(db, "verification"),
  ]);
  const phase = listing ? subscriptionPhase(listing.subscription, now) : "lapsed";
  const listingPlanOk = phase === "active" || phase === "grace";

  let credit: CreditFact = null;
  if (latest?.status === "rejected") {
    const trail = await auditTrail(db, latest.id);
    const entry = [...trail].reverse().find((e) => e.action === "credit" || e.action === "credit_skipped");
    if (entry) credit = entry.action === "credit" ? { kind: "credited", note: entry.reason ?? "" } : { kind: "skipped" };
  }

  const rereview = await loadRereviewState(db, userId, now);
  const view = listerView({
    latest,
    listingPlanOk,
    badgeLive,
    credit,
    now,
    lastApproved: rereview.facts.lastApproved,
    canRereview: canStartRereview(rereview.facts, now).ok,
  });
  const documents =
    latest && view.state === "upload"
      ? (await listDocuments(db, latest.id)).map(({ id, documentType, fileName, sizeBytes, contentType }) => ({
          id,
          documentType,
          fileName,
          sizeBytes,
          contentType,
        }))
      : [];
  const plan = plans.find((p) => p.priceKes > 0) ?? null;
  return {
    context,
    view,
    required: requiredDocumentTypes(context.listerType, context.agencyId !== null),
    documents,
    verificationPlan: plan ? { code: plan.code, priceKes: plan.priceKes } : null,
  };
}
