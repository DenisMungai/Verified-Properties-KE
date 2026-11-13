import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ExternalLink } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { AvatarUploader } from "@/components/account/AvatarUploader";
import { AgencyContacts } from "@/components/agency/AgencyContacts";
import { AgencyDetailsForm, CreateAgencyForm, InviteForm } from "@/components/agency/AgencyForms";
import { ConfirmAction } from "@/components/agency/ConfirmAction";
import { InviteCard } from "@/components/agency/InviteCard";
import { JoinWarning } from "@/components/agency/JoinWarning";
import { PendingInvites } from "@/components/agency/PendingInvites";
import { TeamTable } from "@/components/agency/TeamTable";
import { FormAlert } from "@/components/forms/FormAlert";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { Avatar } from "@/components/ui";
import { getDb } from "@/db";
import { getAgencyContactFor } from "@/db/queries/agency-contacts";
import { getMembership, listMembers, previewJoin, type AgencyMembership } from "@/db/queries/agencies";
import { listAgencyInvites, openInvitesFor } from "@/db/queries/agency-invites";
import { getPublicAgency } from "@/db/queries/public-agencies";
import type { ActionState } from "@/lib/action-state";
import { joinWarning } from "@/lib/agencies/join-plan";
import { formatNairobiDate } from "@/lib/format";
import { single, type SearchParams } from "@/lib/search-params";
import { publicImageBaseUrl } from "@/lib/storage";
import type { CurrentUser } from "@/lib/session";
import { leaveAgencyAction } from "./actions";
import { requireLister } from "../listings/guard";

export const metadata: Metadata = { title: "Agency", robots: { index: false } };

const AGENCY_PATH = "/account/agency";

const count = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Flash after a redirect (actions in ./actions.ts). Numbers come from the transaction's outcome. */
function flashFor(params: Record<string, string | string[] | undefined>): ActionState | null {
  const paused = Number(single(params.paused) ?? 0) || 0;
  const drafted = Number(single(params.drafted) ?? 0) || 0;
  const moved =
    paused + drafted === 0
      ? ""
      : ` ${[paused > 0 && `${count(paused, "listing")} paused`, drafted > 0 && `${count(drafted, "listing")} back to draft`].filter(Boolean).join(", ")}.`;
  switch (single(params.updated)) {
    case "created":
      return { message: `Agency created. You're its admin.${moved}` };
    case "joined":
      return { message: `You've joined the agency.${moved}` };
    case "declined":
      return { message: "Invite declined." };
    case "left":
      return { message: `You've left the agency.${paused > 0 ? ` ${count(paused, "listing")} paused until you have your own listing plan.` : ""}` };
    case "removed":
      return { message: "Member removed. We've emailed them." };
    case "role_admin":
      return { message: "They're now an admin." };
    case "role_member":
      return { message: "They're now an agent." };
    case "invite_revoked":
      return { message: "Invite revoked." };
  }
  switch (single(params.error)) {
    case undefined:
      return null;
    case "last_admin":
      return { formError: "Make someone else an admin first. An agency always needs an admin." };
    case "only_member":
      return { formError: "You're the only member. Contact support to close the agency." };
    case "not_admin":
      return { formError: "Only an agency admin can do that." };
    case "too_many":
      return { formError: "Too many changes in a short time. Please wait a few minutes." };
    default:
      return { formError: "We couldn't make that change. Please try again." };
  }
}

/** Not in an agency: invites addressed to this email, then "Create an agency". */
async function NoAgency({ user, now }: { user: CurrentUser; now: Date }) {
  const db = getDb();
  const [invites, createPlan] = await Promise.all([openInvitesFor(db, user, now), previewJoin(db, user.id, null, now)]);
  const previews = await Promise.all(invites.map((invite) => previewJoin(db, user.id, invite.agencyId, now)));

  return (
    <div className="flex flex-col gap-6">
      {invites.map((invite, i) => (
        <InviteCard
          key={invite.id}
          agencyName={invite.agencyName}
          logoUrl={publicImageBaseUrl(invite.agencyLogoKey)}
          inviterName={invite.inviterName}
          role={invite.role}
          expiresOn={formatNairobiDate(invite.expiresAt)}
          warning={joinWarning(previews[i]!, { agencyName: invite.agencyName, creating: false, formatDate: formatNairobiDate })}
          invite={{ inviteId: invite.id }}
        />
      ))}
      <section aria-labelledby="create-heading" className="flex flex-col gap-5 rounded-lg border border-line bg-white p-5 md:p-6">
        <div className="flex flex-col gap-1">
          <h2 id="create-heading" className="text-title">
            Create an agency
          </h2>
          <p className="text-small text-slate-600">
            List as a team: invite your agents, share one listing plan and get an agency page. To join an existing agency, ask
            its admin to invite your email address ({user.email}).
          </p>
        </div>
        <JoinWarning
          heading="What changes when you create an agency"
          lines={joinWarning(createPlan, { agencyName: "", creating: true, formatDate: formatNairobiDate })}
        />
        <CreateAgencyForm />
      </section>
    </div>
  );
}

function AgencyCard({ membership, publicPage }: { membership: AgencyMembership; publicPage: boolean }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5 sm:flex-row sm:items-center sm:justify-between md:p-6">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={membership.name} baseUrl={publicImageBaseUrl(membership.logoKey)} size="md" />
        <div className="flex min-w-0 flex-col">
          <h2 className="text-title">{membership.name}</h2>
          <p className="text-small text-slate-600">
            You&apos;re {membership.role === "admin" ? "an admin" : "an agent"} here.
            {!publicPage && " The agency page appears once it has a published listing."}
          </p>
        </div>
      </div>
      {publicPage && (
        <Link
          href={`/agencies/${membership.slug}`}
          className="inline-flex min-h-control items-center gap-1.5 text-small font-semibold text-emerald-700 underline underline-offset-4 hover:text-ink"
        >
          View agency page
          <ExternalLink aria-hidden="true" className="size-4" />
        </Link>
      )}
    </section>
  );
}

function LeaveSection() {
  return (
    <section aria-labelledby="leave-heading" className="flex flex-col gap-2 rounded-lg border border-line bg-white p-5 md:p-6">
      <h2 id="leave-heading" className="text-title">
        Leave the agency
      </h2>
      <p className="text-small text-slate-600">
        Your listings go with you. Live ones are paused until you have your own listing plan.
      </p>
      <ConfirmAction
        label="Leave agency"
        consequence="Your listings leave the agency and live ones are paused. Conversations with buyers stay in your Messages."
        confirm="Yes, leave"
        action={leaveAgencyAction}
        className="self-start"
      />
    </section>
  );
}

async function InAgency({ user, membership, now }: { user: CurrentUser; membership: AgencyMembership; now: Date }) {
  const db = getDb();
  const isAdmin = membership.role === "admin";
  const [members, contact, invites, publicAgency] = await Promise.all([
    listMembers(db, membership.agencyId),
    getAgencyContactFor(db, user.id),
    isAdmin ? listAgencyInvites(db, membership.agencyId, now) : Promise.resolve([]),
    getPublicAgency(db, membership.slug),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <AgencyCard membership={membership} publicPage={publicAgency !== null} />
      {isAdmin && (
        <section aria-labelledby="details-heading" className="flex flex-col gap-5 rounded-lg border border-line bg-white p-5 md:p-6">
          <h2 id="details-heading" className="text-title">
            Agency details
          </h2>
          <AvatarUploader kind="logo" name={membership.name} avatarUrl={publicImageBaseUrl(membership.logoKey)} />
          <AgencyDetailsForm
            defaults={{
              name: membership.name,
              description: membership.description ?? "",
              website: membership.websiteUrl ?? "",
              officeMapUrl: membership.officeMapUrl ?? "",
            }}
          />
        </section>
      )}
      {contact && <AgencyContacts agency={contact} />}
      <TeamTable
        members={members.map(({ avatarKey, ...member }) => ({ ...member, avatarUrl: publicImageBaseUrl(avatarKey) }))}
        viewerId={user.id}
        isAdmin={isAdmin}
      />
      {isAdmin && (
        <section aria-labelledby="invite-heading" className="flex flex-col gap-5 rounded-lg border border-line bg-white p-5 md:p-6">
          <div className="flex flex-col gap-1">
            <h2 id="invite-heading" className="text-title">
              Invite an agent
            </h2>
            <p className="text-small text-slate-600">
              We email them a link that works for 7 days. Their listings join the agency when they accept and count toward its plan.
            </p>
          </div>
          <InviteForm />
          <PendingInvites invites={invites} />
        </section>
      )}
      <LeaveSection />
    </div>
  );
}

async function Agency({ searchParams }: { searchParams: SearchParams }) {
  const [user, params] = await Promise.all([requireLister(AGENCY_PATH), searchParams]);
  const now = new Date();
  const membership = await getMembership(getDb(), user.id);
  const flash = flashFor(params);
  return (
    <div className="flex flex-col gap-6">
      {flash && <FormAlert state={flash} />}
      {membership ? <InAgency user={user} membership={membership} now={now} /> : <NoAgency user={user} now={now} />}
    </div>
  );
}

export default function AgencyPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Agency" description="List as a team with one shared plan and an agency page." />
      <Suspense fallback={<FormSkeleton fields={4} />}>
        <Agency searchParams={searchParams} />
      </Suspense>
    </>
  );
}
