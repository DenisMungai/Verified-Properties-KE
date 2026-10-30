"use server";

import { refresh } from "next/cache";
import { getDb } from "@/db";
import { markRead } from "@/db/queries/inquiries";
import { requireLister } from "@/app/account/listings/guard";

/**
 * Mark one inquiry (`inquiryId`) or all of them read. The query only touches inquiries about
 * listings this lister can manage, so a forged id marks nothing.
 */
export async function markInquiriesReadAction(formData: FormData): Promise<void> {
  const user = await requireLister("/account/inquiries");
  const value = formData.get("inquiryId");
  const inquiryId = typeof value === "string" && value !== "" ? value : undefined;
  try {
    await markRead(getDb(), user.id, inquiryId);
  } catch (error) {
    console.error("[inquiries] mark read failed", error instanceof Error ? error.name : "unknown");
  }
  refresh();
}
