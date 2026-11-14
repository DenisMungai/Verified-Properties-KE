import "server-only";
import { getDocumentWithLister, insertAudit } from "@/db/queries/verification";
import { errorName } from "@/lib/log";
import type { CurrentUser } from "@/lib/session";
import type { ObjectStore } from "@/lib/storage/object-store";
import type { ListerDeps } from "./lister";

/**
 * Opens one verification document for a platform admin (prompt S12 decision 7, S17 exit fix F1).
 * Every view is written to the append-only audit log first, then the admin gets a 60-second
 * presigned GET on the private bucket. Anyone else gets `not_found` before any database read, so
 * the caller can't reveal what exists.
 */

/** The store is a getter: it is opened only for an admin, after the audit row (it throws when unconfigured). */
export type DocumentViewDeps = Pick<ListerDeps, "db" | "withTransaction"> & { privateStore: () => ObjectStore };
export type DocumentViewer = Pick<CurrentUser, "id" | "emailVerified" | "roles">;
export type DocumentViewResult = { ok: true; url: string } | { ok: false; code: "not_found" | "unavailable" };

export const DOCUMENT_LINK_SECONDS = 60;

export async function openDocumentForAdmin(
  deps: DocumentViewDeps,
  viewer: DocumentViewer | null,
  documentId: string,
): Promise<DocumentViewResult> {
  if (!viewer || !viewer.emailVerified || !viewer.roles.includes("platform_admin")) return { ok: false, code: "not_found" };

  const document = await getDocumentWithLister(deps.db, documentId);
  if (!document) return { ok: false, code: "not_found" };

  try {
    await deps.withTransaction((tx) =>
      insertAudit(tx, {
        requestId: document.requestId,
        actorUserId: viewer.id,
        action: "view_document",
        reason: `${document.documentType} ${document.id}`,
      }),
    );
    return { ok: true, url: await deps.privateStore().presignGet(document.storageKey, DOCUMENT_LINK_SECONDS) };
  } catch (error) {
    console.error("[verification] view document failed", errorName(error));
    return { ok: false, code: "unavailable" };
  }
}
