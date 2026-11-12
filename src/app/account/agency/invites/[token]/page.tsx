import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MailX } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { InviteCard } from "@/components/agency/InviteCard";
import { FormAlert } from "@/components/forms/FormAlert";
import { FormSkeleton } from "@/components/forms/FormSkeleton";
import { EmptyState, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { getMembership, previewJoin } from "@/db/queries/agencies";
import { getInvite, type InviteState } from "@/db/queries/agency-invites";
import { getListerProfile } from "@/db/queries/lister-profiles";
import type { ActionState } from "@/lib/action-state";
import { hashInviteToken, invitePath, isWellFormedInviteToken } from "@/lib/agencies/invite-token";
import { joinWarning } from "@/lib/agencies/join-plan";
import { maskEmail } from "@/lib/email/send";
import { formatNairobiDate } from "@/lib/format";
import { single, type SearchParams } from "@/lib/search-params";
import { requireUser } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";

// The token is a credential: keep the page out of search engines and referrers.
export const metadata: Metadata = { title: "Agency invite", robots: { index: false, follow: false }, referrer: "no-referrer" };

type Params = Promise<{ token: string }>;

const CLOSED: Record<Exclude<InviteState, "open">, string> = {
  expired: "This invite has expired. Ask the agency's admin to send a new one.",
  revoked: "This invite was cancelled by the agency. Ask its admin if you still want to join.",
  declined: "You declined this invite. Ask the agency's admin for a new one if you change your mind.",
  accepted: "This invite has already been used.",
};

const ERRORS: Record<string, string> = {
  wrong_email: "This invite is for a different email address.",
  already_in_agency: "You're already part of an agency. Leave it first to accept this invite.",
  no_profile: "Set up your listing profile first, then accept the invite.",
  too_many: "Too many attempts. Please wait a few minutes and try again.",
};

function Notice({ title, description, action }: { title: string; description: string; action?: { href: string; label: string } }) {
  return (
    <EmptyState
      icon={<MailX />}
      title={title}
      description={description}
      action={
        action && (
          <Link href={action.href} className={buttonClasses()}>
            {action.label}
          </Link>
        )
      }
    />
  );
}

async function Invite({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ token }, query] = await Promise.all([params, searchParams]);
  const path = isWellFormedInviteToken(token) ? invitePath(token) : "/account/agency";
  const user = await requireUser(path);
  if (!isWellFormedInviteToken(token)) {
    return <Notice title="This invite link isn't valid" description="Check that you copied the whole link from the email." />;
  }

  const db = getDb();
  const now = new Date();
  const invite = await getInvite(db, { kind: "hash", hash: hashInviteToken(token) }, now);
  if (!invite) return <Notice title="This invite link isn't valid" description="Check that you copied the whole link from the email." />;
  if (invite.state !== "open") {
    return <Notice title={`Invite to ${invite.agencyName}`} description={CLOSED[invite.state]} action={{ href: "/account", label: "Go to your account" }} />;
  }
  if (invite.email !== user.email.toLowerCase()) {
    return (
      <Notice
        title={`Invite to ${invite.agencyName}`}
        description={`This invite was sent to ${maskEmail(invite.email)}. Sign in with that email to accept it.`}
        action={{ href: "/account/settings", label: "Account settings" }}
      />
    );
  }

  const [profile, membership] = await Promise.all([getListerProfile(db, user.id), getMembership(db, user.id)]);
  if (membership) {
    return (
      <Notice
        title={`Invite to ${invite.agencyName}`}
        description={`You're part of ${membership.name}. Leave it first to accept this invite.`}
        action={{ href: "/account/agency", label: "Go to Agency" }}
      />
    );
  }
  if (!profile) {
    return (
      <Notice
        title={`Join ${invite.agencyName}`}
        description="Set up your listing profile first. You'll come straight back to this invite."
        action={{ href: `/account/onboarding?next=${encodeURIComponent(path)}`, label: "Set up listing profile" }}
      />
    );
  }

  const error = single(query.error);
  const flash: ActionState | null = error ? { formError: ERRORS[error] ?? "We couldn't accept the invite. Please try again." } : null;
  const plan = await previewJoin(db, user.id, invite.agencyId, now);
  return (
    <div className="flex flex-col gap-6">
      {flash && <FormAlert state={flash} />}
      <InviteCard
        agencyName={invite.agencyName}
        logoUrl={publicImageBaseUrl(invite.agencyLogoKey)}
        inviterName={invite.inviterName}
        role={invite.role}
        expiresOn={formatNairobiDate(invite.expiresAt)}
        warning={joinWarning(plan, { agencyName: invite.agencyName, creating: false, formatDate: formatNairobiDate })}
        invite={{ token }}
      />
    </div>
  );
}

export default function AgencyInvitePage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <>
      <PageHeading title="Agency invite" />
      <Suspense fallback={<FormSkeleton fields={2} />}>
        <Invite params={params} searchParams={searchParams} />
      </Suspense>
    </>
  );
}
