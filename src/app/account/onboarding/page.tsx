import type { Metadata } from "next";
import { Suspense } from "react";
import { ListerProfileForm } from "@/components/account/ListerProfileForm";
import { PageHeading } from "@/components/account/PageHeading";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { getDb } from "@/db";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { requireUser } from "@/lib/session";
import { profileDefaults } from "../profile-defaults";

export const metadata: Metadata = { title: "Set up your listing profile" };

async function Onboarding() {
  const user = await requireUser("/account/onboarding");
  const profile = await getListerProfile(getDb(), user.id);
  return <ListerProfileForm defaults={profileDefaults(profile, user.name)} redirectTo="overview" submitLabel="Save and continue" />;
}

export default function OnboardingPage() {
  return (
    <>
      <PageHeading
        title="Set up your listing profile"
        description="Buyers see this next to your listings. You can change it any time."
      />
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <Onboarding />
      </Suspense>
    </>
  );
}
