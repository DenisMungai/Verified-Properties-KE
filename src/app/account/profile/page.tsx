import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ListerProfileForm } from "@/components/account/ListerProfileForm";
import { PageHeading } from "@/components/account/PageHeading";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { getDb } from "@/db";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { requireUser } from "@/lib/session";
import { profileDefaults } from "../profile-defaults";

export const metadata: Metadata = { title: "Listing profile" };

async function ProfileEditor() {
  const user = await requireUser("/account/profile");
  const profile = await getListerProfile(getDb(), user.id);
  if (!profile) redirect("/account/onboarding");
  return <ListerProfileForm defaults={profileDefaults(profile, user.name)} redirectTo="stay" submitLabel="Save changes" />;
}

export default function ListingProfilePage() {
  return (
    <>
      <PageHeading title="Listing profile" description="How buyers see you next to your listings." />
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <ProfileEditor />
      </Suspense>
    </>
  );
}
