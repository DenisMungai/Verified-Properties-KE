import type { Metadata } from "next";
import { Suspense } from "react";
import { BasicsForm } from "@/components/listings/BasicsForm";
import { ListingEditorLayout, ListingEditorSkeleton } from "@/components/listings/ListingEditorLayout";
import { PlanUsagePanel } from "@/components/listings/PlanUsagePanel";
import { getDb } from "@/db";
import { getListingPlanUsage } from "@/db/queries/billing";
import { EMPTY_BASICS, editorHeading } from "../editor-data";
import { requireLister } from "../guard";

export const metadata: Metadata = { title: "Create a property listing" };

async function NewListing() {
  const user = await requireLister("/account/listings/new");
  const usage = await getListingPlanUsage(getDb(), user.id);
  return (
    <ListingEditorLayout {...editorHeading(null)} step="basics" aside={<PlanUsagePanel usage={usage} />}>
      <BasicsForm defaults={EMPTY_BASICS} />
    </ListingEditorLayout>
  );
}

export default function NewListingPage() {
  return (
    <Suspense fallback={<ListingEditorSkeleton />}>
      <NewListing />
    </Suspense>
  );
}
