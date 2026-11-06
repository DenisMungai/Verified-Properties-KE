import { getDb } from "@/db";
import { getDocumentWithLister, insertAudit } from "@/db/queries/verification";
import { withTransaction } from "@/db/tx";
import { getCurrentUser } from "@/lib/session";
import { getPrivateStore } from "@/lib/storage";

/**
 * Opens one verification document for a platform admin (prompt S12 decision 7). Every view is
 * written to the append-only audit log first, then the admin is sent to a 60-second presigned GET
 * on the private bucket. Anyone else gets a 404, so the route doesn't reveal what exists.
 */

const LINK_SECONDS = 60;
const NOT_FOUND = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }): Promise<Response> {
  const user = await getCurrentUser();
  if (!user || !user.emailVerified || !user.roles.includes("platform_admin")) return NOT_FOUND();

  const { documentId } = await params;
  const document = await getDocumentWithLister(getDb(), documentId);
  if (!document) return NOT_FOUND();

  try {
    await withTransaction((tx) =>
      insertAudit(tx, {
        requestId: document.requestId,
        actorUserId: user.id,
        action: "view_document",
        reason: `${document.documentType} ${document.id}`,
      }),
    );
    const url = await getPrivateStore().presignGet(document.storageKey, LINK_SECONDS);
    return new Response(null, {
      status: 303,
      headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  } catch (error) {
    console.error("[verification] view document failed", error instanceof Error ? error.name : "unknown");
    return new Response("This document can't be opened right now.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
