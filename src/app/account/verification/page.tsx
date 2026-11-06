import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeading } from "@/components/account/PageHeading";
import { Skeleton } from "@/components/ui";
import { DocumentChecklist } from "@/components/verification/DocumentChecklist";
import { ListerStatus } from "@/components/verification/ListerStatus";
import { getDb } from "@/db";
import { VERIFICATION_PATH } from "@/lib/verification/app-deps";
import { loadListerVerification } from "@/lib/verification/load";
import { requireLister } from "../listings/guard";

export const metadata: Metadata = { title: "Verification", robots: { index: false } };

/** Lister verification (prompt S12 decision 10). Reads only the signed-in lister's own request. */
async function Verification() {
  const user = await requireLister(VERIFICATION_PATH);
  const data = await loadListerVerification(getDb(), user.id, new Date());
  if (!data) return null;
  return (
    <div className="flex flex-col gap-6">
      <ListerStatus view={data.view} required={data.required} plan={data.verificationPlan} />
      {data.view.state === "upload" && <DocumentChecklist required={data.required} documents={data.documents} />}
    </div>
  );
}

function VerificationSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading verification</span>
      <Skeleton className="h-48 rounded-lg" />
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}

export default function VerificationPage() {
  return (
    <div className="flex max-w-3xl flex-col">
      <PageHeading
        title="Verification"
        description="Get the “Profile verified” badge: pay, upload your documents, and our team reviews them."
      />
      <Suspense fallback={<VerificationSkeleton />}>
        <Verification />
      </Suspense>
    </div>
  );
}
