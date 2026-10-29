import "server-only";
import { getPublicStore } from "@/lib/storage";
import { deleteImageObjects } from "@/lib/storage/ingest";

/**
 * Best-effort removal of stored variants after their rows are deleted. Leftover files are
 * unreachable and the orphan sweep (S9) removes them. Kept out of the "use server" modules so it
 * can never be called from the browser.
 */
export async function deleteStoredPhotos(baseKeys: string[]): Promise<void> {
  if (baseKeys.length === 0) return;
  try {
    const store = getPublicStore();
    for (const key of baseKeys) await deleteImageObjects(store, key);
  } catch (error) {
    console.error("[photos] delete files failed", error instanceof Error ? error.name : "unknown");
  }
}
