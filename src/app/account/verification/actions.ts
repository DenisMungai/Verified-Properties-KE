"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { POLICIES, RateLimitUnavailableError, checkRateLimits, rateLimitKey, tooManyAttemptsMessage } from "@/lib/rate-limit";
import { StorageNotConfiguredError } from "@/lib/storage/object-store";
import { getDecisionDeps, getListerDeps, VERIFICATION_PATH } from "@/lib/verification/app-deps";
import { finalizeDocument, removeDocument, requestDocumentUpload, submitForReview } from "@/lib/verification/lister";
import { startRereview } from "@/lib/verification/rereview";
import {
  DOCUMENT_MIME_TYPES,
  DOCUMENT_REJECT_MESSAGES,
  DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
} from "@/lib/verification/rules";
import { requireLister } from "../listings/guard";

/**
 * Lister verification actions (prompt S12 decisions 6, 10 and 12). The browser sends a document
 * type, a file's declared type and size, an upload key or a document id, never a request id or a
 * status. Every action re-checks the session and touches only the caller's own open request.
 * Logs carry no keys, file names or personal data.
 */

export type VerificationActionResult = { ok: true; message?: string } | { ok: false; error: string };

const GENERIC_FAILURE = "Something went wrong. Please try again.";
const NOT_SET_UP = "Document uploads are not set up yet.";

function logFailure(action: string, error: unknown): void {
  console.error(`[verification] ${action} failed`, error instanceof Error ? error.name : "unknown");
}

function failure(error: unknown, action: string): { ok: false; error: string } {
  if (error instanceof StorageNotConfiguredError) return { ok: false, error: NOT_SET_UP };
  if (!(error instanceof RateLimitUnavailableError)) logFailure(action, error);
  return { ok: false, error: GENERIC_FAILURE };
}

const documentTypeSchema = z.enum(DOCUMENT_TYPES, { error: "Choose which document this is." });

const uploadRequestSchema = z.object({
  documentType: documentTypeSchema,
  contentType: z.enum(DOCUMENT_MIME_TYPES, { error: DOCUMENT_REJECT_MESSAGES.type }),
  size: z.int().min(1, { error: DOCUMENT_REJECT_MESSAGES.empty }).max(MAX_DOCUMENT_BYTES, { error: DOCUMENT_REJECT_MESSAGES.size }),
});

/** Step 1: checks the file's type and size and the caller's request, then signs one upload. */
export async function requestDocumentUploadAction(input: {
  documentType: string;
  contentType: string;
  size: number;
}): Promise<{ ok: true; uploadUrl: string; uploadKey: string } | { ok: false; error: string }> {
  const user = await requireLister(VERIFICATION_PATH);
  const parsed = uploadRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC_FAILURE };
  try {
    const limit = await checkRateLimits([[POLICIES.verificationUploadPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };
    const result = await requestDocumentUpload(getListerDeps(), { userId: user.id, ...parsed.data });
    return result.ok ? { ok: true, uploadUrl: result.uploadUrl, uploadKey: result.uploadKey } : { ok: false, error: result.message };
  } catch (error) {
    return failure(error, "request upload");
  }
}

const finalizeSchema = z.object({
  uploadKey: z.string().max(200),
  documentType: documentTypeSchema,
  fileName: z.string().max(500),
});

/** Step 2: verifies, cleans and records the upload. */
export async function finalizeDocumentAction(input: {
  uploadKey: string;
  documentType: string;
  fileName: string;
}): Promise<VerificationActionResult> {
  const user = await requireLister(VERIFICATION_PATH);
  const parsed = finalizeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_FAILURE };
  try {
    const result = await finalizeDocument(getListerDeps(), { userId: user.id, ...parsed.data });
    if (!result.ok) return { ok: false, error: result.message };
  } catch (error) {
    return failure(error, "finalize upload");
  }
  refresh();
  return { ok: true, message: "Document added." };
}

export async function removeDocumentAction(input: { documentId: string }): Promise<VerificationActionResult> {
  const user = await requireLister(VERIFICATION_PATH);
  const parsed = z.object({ documentId: z.uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC_FAILURE };
  try {
    const result = await removeDocument(getListerDeps(), { userId: user.id, documentId: parsed.data.documentId });
    if (!result.ok) return { ok: false, error: result.message };
  } catch (error) {
    return failure(error, "remove document");
  }
  refresh();
  return { ok: true, message: "Document removed." };
}

export async function submitVerificationAction(): Promise<VerificationActionResult> {
  const user = await requireLister(VERIFICATION_PATH);
  try {
    const limit = await checkRateLimits([[POLICIES.verificationSubmitPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };
    const result = await submitForReview(getListerDeps(), user.id);
    if (!result.ok) return { ok: false, error: result.message };
  } catch (error) {
    return failure(error, "submit");
  }
  refresh();
  return { ok: true, message: "Submitted. We'll review your documents, usually within 2 working days." };
}

/**
 * Starts a free re-review (prompt S13 decisions 3–4). Takes nothing from the browser: eligibility
 * and the review being renewed are worked out from the session user's own records.
 */
export async function startRereviewAction(): Promise<VerificationActionResult> {
  const user = await requireLister(VERIFICATION_PATH);
  try {
    const limit = await checkRateLimits([[POLICIES.verificationSubmitPerUser, rateLimitKey(user.id)]]);
    if (!limit.ok) return { ok: false, error: tooManyAttemptsMessage(limit.retryAfterSeconds) };
    const result = await startRereview(getDecisionDeps(), user.id);
    if (!result.ok) return { ok: false, error: result.message };
  } catch (error) {
    return failure(error, "start re-review");
  }
  refresh();
  return { ok: true, message: "Re-review started. Upload your documents below, then submit." };
}
