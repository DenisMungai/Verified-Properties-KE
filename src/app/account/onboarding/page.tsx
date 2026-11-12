import type { Metadata } from "next";
import { Suspense } from "react";
import { ListerProfileForm } from "@/components/account/ListerProfileForm";
import { PageHeading } from "@/components/account/PageHeading";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { getDb } from "@/db";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { safeNextPath } from "@/lib/safe-redirect";
import { single, type SearchParams } from "@/lib/search-params";
import { requireUser } from "@/lib/session";
import { profileDefaults } from "../profile-defaults";

export const metadata: Metadata = { title: "Set up your listing profile" };

async function Onboarding({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireUser("/account/onboarding"), searchParams]);
  const profile = await getListerProfile(getDb(), user.id);
  // Only a safe same-site path survives; anything else falls back to the overview.
  const requested = single(params.next);
  const next = requested && safeNextPath(requested, "") ? safeNextPath(requested) : undefined;
  return (
    <ListerProfileForm defaults={profileDefaults(profile, user.name)} redirectTo="overview" submitLabel="Save and continue" next={next} />
  );
}

export default function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading
        title="Set up your listing profile"
        description="Buyers see this next to your listings. You can change it any time."
      />
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <Onboarding searchParams={searchParams} />
      </Suspense>
    </>
  );
}
