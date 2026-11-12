import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AgencyContactForm } from "@/components/account/AgencyContactForm";
import { AvatarUploader } from "@/components/account/AvatarUploader";
import { ListerProfileForm } from "@/components/account/ListerProfileForm";
import { PageHeading } from "@/components/account/PageHeading";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { getDb } from "@/db";
import { getAgencyContactFor, type AgencyContactView } from "@/db/queries/agency-contacts";
import { getListerProfile } from "@/db/queries/lister-profiles";
import { displayKenyanPhone } from "@/lib/kenya";
import { requireUser } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";
import { profileDefaults } from "../profile-defaults";

export const metadata: Metadata = { title: "Listing profile" };

/** Office contacts shown under the agent's on the agency's listings (prompt lister-contact-buttons). */
function AgencyContacts({ agency }: { agency: AgencyContactView }) {
  const rows = [
    ["Office phone", agency.phone && displayKenyanPhone(agency.phone)],
    ["WhatsApp", agency.whatsapp && displayKenyanPhone(agency.whatsapp)],
    ["Office email", agency.email],
  ] as const;
  return (
    <section aria-labelledby="agency-contacts" className="flex max-w-2xl flex-col gap-4 border-t border-line pt-6">
      <div className="flex flex-col gap-1">
        <h2 id="agency-contacts" className="text-title">
          Agency contact details
        </h2>
        <p className="text-small text-slate-600">
          {agency.name}&apos;s office contacts appear under yours on the agency&apos;s listings.
          {!agency.canEdit && " Only an agency admin can change them."}
        </p>
      </div>
      {agency.canEdit ? (
        <AgencyContactForm
          defaults={{
            phone: agency.phone ? displayKenyanPhone(agency.phone) : "",
            whatsappSameAsPhone: Boolean(agency.whatsapp) && agency.whatsapp === agency.phone,
            whatsapp: agency.whatsapp && agency.whatsapp !== agency.phone ? displayKenyanPhone(agency.whatsapp) : "",
            email: agency.email ?? "",
          }}
        />
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-small">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-slate-600">{label}</dt>
              <dd className="break-all text-ink">{value || "Not set"}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
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
      {agency && <AgencyContacts agency={agency} />}
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
