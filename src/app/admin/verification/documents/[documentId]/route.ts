import { getDb } from "@/db";
import { withTransaction } from "@/db/tx";
import { getCurrentUser } from "@/lib/session";
import { getPrivateStore } from "@/lib/storage";
import { openDocumentForAdmin } from "@/lib/verification/document-view";

/** Opens one verification document for a platform admin. See `openDocumentForAdmin`. */
export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }): Promise<Response> {
  const [user, { documentId }] = await Promise.all([getCurrentUser(), params]);
  const result = await openDocumentForAdmin({ db: getDb(), withTransaction, privateStore: getPrivateStore }, user, documentId);

  if (result.ok) {
    return new Response(null, {
      status: 303,
      headers: { Location: result.url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
    });
  }
  if (result.code === "unavailable") {
    return new Response("This document can't be opened right now.", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
}
