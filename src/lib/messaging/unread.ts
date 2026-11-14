import "server-only";
import { cache } from "react";
import { getDb } from "@/db";
import { unreadTotal } from "@/db/queries/messaging";
import { errorName } from "@/lib/log";

/**
 * The signed-in user's unread message count, read once per request (the header's desktop and
 * mobile menus and the account nav share it). A failure shows no badge rather than breaking the
 * page; the client poll corrects it.
 */
export const unreadForUser = cache(async (userId: string): Promise<number> => {
  try {
    return await unreadTotal(getDb(), userId);
  } catch (error) {
    console.error("[messaging] unread count failed", errorName(error));
    return 0;
  }
});
