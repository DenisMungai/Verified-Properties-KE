import "server-only";
import { randomUUID } from "node:crypto";
import type { DbExecutor } from "@/db/executor";
import {
  deleteDocument,
  getListerContext,
  getOpenRequest,
  insertAudit,
  insertDocument,
  listDocuments,
  lockRequest,
  updateRequest,
} from "@/db/queries/verification";
import { isOwnVerificationUploadKey, newVerificationUploadKey, verificationDocumentKey } from "@/lib/storage/keys";
import { PRESIGN_SECONDS } from "@/lib/storage/limits";
import { TooLargeError, type ObjectStore } from "@/lib/storage/object-store";
import { cleanDocument, DocumentRejectedError } from "./documents";
import {
  canTransition,
  DOCUMENT_REJECT_MESSAGES,
  MAX_DOCUMENT_BYTES,
  MAX_DOCUMENT_FILES,
  MAX_FILES_PER_TYPE,
  missingDocumentTypes,
  requiredDocumentTypes,
  sanitizeFileName,
  type DocumentMime,
  type DocumentType,
} from "./rules";

/**
 * What a lister does with their own request (prompt S12 decisions 6 and 10). Every function takes
 * the session user id and only ever touches that user's open request; ids from the browser are
 * lookups that must belong to it.
 */

export interface ListerDeps {
  db: DbExecutor;
  withTransaction: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  now: () => Date;
  privateStore: ObjectStore;
}

export type ListerRefusal = "no_request" | "not_accepting" | "too_many" | "missing_documents" | "invalid_upload" | "not_found";

export const LISTER_MESSAGES: Record<ListerRefusal, string> = {
  no_request: "There's no verification waiting for documents. Start or pay for verification first.",
  not_accepting: "This verification isn't taking documents right now.",
  too_many: DOCUMENT_REJECT_MESSAGES.perType,
  missing_documents: "Add every required document before you submit.",
  invalid_upload: "That upload is not valid. Please try again.",
  not_found: "We couldn't find that document.",
};

export type ListerResult<T = object> = ({ ok: true } & T) | { ok: false; code: ListerRefusal | "rejected"; message: string };

const refuse = (code: ListerRefusal): { ok: false; code: ListerRefusal; message: string } => ({ ok: false, code, message: LISTER_MESSAGES[code] });

/** Whether one more file of `type` fits (per type and in all). */
export function documentFits(existing: readonly { documentType: string }[], type: DocumentType): "ok" | "per_type" | "total" {
  if (existing.length >= MAX_DOCUMENT_FILES) return "total";
  if (existing.filter((d) => d.documentType === type).length >= MAX_FILES_PER_TYPE) return "per_type";
  return "ok";
}

function fitsMessage(fit: "per_type" | "total"): { ok: false; code: "too_many"; message: string } {
  return { ok: false, code: "too_many", message: fit === "total" ? DOCUMENT_REJECT_MESSAGES.total : DOCUMENT_REJECT_MESSAGES.perType };
}

/** Step 1: signs one upload to a temporary key in the private bucket. */
export async function requestDocumentUpload(
  deps: ListerDeps,
  input: { userId: string; documentType: DocumentType; contentType: DocumentMime; size: number },
): Promise<ListerResult<{ uploadUrl: string; uploadKey: string }>> {
  const request = await getOpenRequest(deps.db, input.userId);
  if (!request) return refuse("no_request");
  if (request.status !== "documents_pending") return refuse("not_accepting");
  const fit = documentFits(await listDocuments(deps.db, request.id), input.documentType);
  if (fit !== "ok") return fitsMessage(fit);
  const uploadKey = newVerificationUploadKey(input.userId);
  const uploadUrl = await deps.privateStore.presignPut(uploadKey, input.contentType, input.size, PRESIGN_SECONDS);
  return { ok: true, uploadUrl, uploadKey };
}

/**
 * Step 2: checks and cleans the upload, stores it under its final key, then records it. The
 * temporary upload is always deleted; the final object is deleted again if recording fails.
 */
export async function finalizeDocument(
  deps: ListerDeps,
  input: { userId: string; uploadKey: string; documentType: DocumentType; fileName: string },
): Promise<ListerResult<{ documentId: string }>> {
  const { userId, uploadKey } = input;
  if (!isOwnVerificationUploadKey(uploadKey, userId)) return refuse("invalid_upload");

  let finalKey: string | null = null;
  try {
    const request = await getOpenRequest(deps.db, userId);
    if (!request) return refuse("no_request");
    if (request.status !== "documents_pending") return refuse("not_accepting");

    let raw: Buffer | null;
    try {
      raw = await deps.privateStore.get(uploadKey, MAX_DOCUMENT_BYTES);
    } catch (error) {
      if (error instanceof TooLargeError) return { ok: false, code: "rejected", message: DOCUMENT_REJECT_MESSAGES.size };
      throw error;
    }
    if (!raw) return refuse("invalid_upload");
    const clean = await cleanDocument(raw);

    const documentId = randomUUID();
    finalKey = verificationDocumentKey(userId, request.id, documentId);
    await deps.privateStore.put(finalKey, clean.body, clean.contentType);

    const recorded = await deps.withTransaction(async (tx): Promise<ListerResult> => {
      const locked = await lockRequest(tx, request.id);
      if (!locked || locked.listerUserId !== userId || locked.status !== "documents_pending") return refuse("not_accepting");
      const fit = documentFits(await listDocuments(tx, locked.id), input.documentType);
      if (fit !== "ok") return fitsMessage(fit);
      await insertDocument(tx, {
        id: documentId,
        requestId: locked.id,
        storageKey: finalKey!,
        documentType: input.documentType,
        fileName: sanitizeFileName(input.fileName),
        contentType: clean.contentType,
        sizeBytes: clean.body.length,
      });
      await insertAudit(tx, { requestId: locked.id, actorUserId: userId, action: "upload", reason: input.documentType });
      return { ok: true };
    });
    if (!recorded.ok) return recorded;
    finalKey = null;
    return { ok: true, documentId };
  } catch (error) {
    if (error instanceof DocumentRejectedError) return { ok: false, code: "rejected", message: error.userMessage };
    throw error;
  } finally {
    const leftovers = finalKey ? [uploadKey, finalKey] : [uploadKey];
    await deps.privateStore.delete(leftovers).catch(() => undefined);
  }
}

/** Removes one document while the request still takes documents. */
export async function removeDocument(deps: ListerDeps, input: { userId: string; documentId: string }): Promise<ListerResult> {
  const removed = await deps.withTransaction(async (tx) => {
    const request = await getOpenRequest(tx, input.userId, true);
    if (!request) return refuse("no_request");
    if (request.status !== "documents_pending") return refuse("not_accepting");
    const document = await deleteDocument(tx, request.id, input.documentId);
    if (!document) return refuse("not_found");
    await insertAudit(tx, { requestId: request.id, actorUserId: input.userId, action: "remove_document", reason: document.documentType });
    return { ok: true as const, storageKey: document.storageKey };
  });
  if (!removed.ok) return removed;
  // A failed delete leaves an unreferenced object for the storage sweep.
  await deps.privateStore.delete([removed.storageKey]).catch(() => undefined);
  return { ok: true };
}

/** Sends the request for review once every required document type has a file. */
export async function submitForReview(deps: ListerDeps, userId: string): Promise<ListerResult> {
  const lister = await getListerContext(deps.db, userId);
  if (!lister) return refuse("no_request");
  const required = requiredDocumentTypes(lister.listerType, lister.agencyId !== null);
  return deps.withTransaction(async (tx) => {
    const request = await getOpenRequest(tx, userId, true);
    if (!request) return refuse("no_request");
    if (!canTransition(request.status, "under_review")) return refuse("not_accepting");
    const documents = await listDocuments(tx, request.id);
    if (missingDocumentTypes(required, documents.map((d) => d.documentType)).length > 0) return refuse("missing_documents");
    await updateRequest(tx, request.id, { status: "under_review", submittedAt: deps.now(), decisionReason: null });
    await insertAudit(tx, { requestId: request.id, actorUserId: userId, action: "submit" });
    return { ok: true };
  });
}
