import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AvatarUploader } from "@/components/account/AvatarUploader";
import { ListerProfileForm } from "@/components/account/ListerProfileForm";
import { PageHeading } from "@/components/account/PageHeading";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { getDb } from "@/db";
import { getAgencyContactFor } from "@/db/queries/agency-contacts";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { requireUser } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";
import { profileDefaults } from "../profile-defaults";

export const metadata: Metadata = { title: "Listing profile" };

/** Agency details and office contacts moved to Account → Agency (prompt S23 decision 10). */
function AgencyLink({ agencyName }: { agencyName: string }) {
  return (
    <p className="max-w-2xl border-t border-line pt-6 text-small text-slate-600">
      You list for {agencyName}. Its details, office contacts and team are on{" "}
      <Link href="/account/agency" className="font-semibold text-emerald-700 underline underline-offset-4">
        Agency
      </Link>
      .
    </p>
  );
}

async function ProfileEditor() {
  const user = await requireUser("/account/profile");
  const db = getDb();
  const [profile, agency] = await Promise.all([getListerProfile(db, user.id), getAgencyContactFor(db, user.id)]);
  if (!profile) redirect("/account/onboarding");
  return (
    <div className="flex flex-col gap-6">
      {/* Only the public URL reaches the client; the storage key stays here. */}
      <AvatarUploader name={profile.displayName} avatarUrl={publicImageBaseUrl(profile.avatarKey)} />
      <ListerProfileForm defaults={profileDefaults(profile, user.name)} redirectTo="stay" submitLabel="Save changes" />
      {agency && <AgencyLink agencyName={agency.name} />}
    </div>
  );
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
