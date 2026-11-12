import { Avatar, Badge } from "@/components/ui";
import { removeMemberAction, setMemberRoleAction } from "@/app/account/agency/actions";
import type { AgencyMemberRow } from "@/db/queries/agencies";
import { cn } from "@/lib/cn";
import { formatNairobiDate } from "@/lib/format";
import { ConfirmAction } from "./ConfirmAction";

export interface TeamMember extends Omit<AgencyMemberRow, "avatarKey"> {
  avatarUrl: string | null;
}

const ROLE_LABEL = { admin: "Admin", member: "Agent" } as const;

function RoleBadge({ role }: { role: TeamMember["role"] }) {
  return <Badge tone={role === "admin" ? "verified" : "neutral"}>{ROLE_LABEL[role]}</Badge>;
}

/** Admin row actions (decision 10): change the role, remove. Never on the admin's own row. */
function MemberActions({ member, viewerId, isAdmin }: { member: TeamMember; viewerId: string; isAdmin: boolean }) {
  if (!isAdmin || member.userId === viewerId) return null;
  const promote = member.role === "member";
  return (
    <div className="flex flex-wrap gap-x-2">
      <ConfirmAction
        label={promote ? "Make admin" : "Make agent"}
        srLabel={` ${member.displayName}`}
        consequence={
          promote
            ? "Admins manage the agency, its plan and every agency listing."
            : "They keep their listings but can no longer manage the agency."
        }
        confirm={promote ? "Yes, make admin" : "Yes, make agent"}
        variant="secondary"
        action={setMemberRoleAction}
        fields={{ userId: member.userId, role: promote ? "admin" : "member" }}
      />
      <ConfirmAction
        label="Remove"
        srLabel={` ${member.displayName}`}
        consequence={
          <>
            Their listings leave the agency with them and live ones are paused until they have their own plan. We&apos;ll
            email them.
          </>
        }
        confirm="Yes, remove"
        action={removeMemberAction}
        fields={{ userId: member.userId }}
      />
    </div>
  );
}

/** Team on /account/agency: separated rows from md, cards below (like InvoiceTable). */
export function TeamTable({ members, viewerId, isAdmin }: { members: TeamMember[]; viewerId: string; isAdmin: boolean }) {
  return (
    <section aria-labelledby="team-heading" className="rounded-lg border border-line bg-white p-4 md:p-5">
      <h2 id="team-heading" className="mb-2 text-title">
        Team ({members.length})
      </h2>
      <table className="hidden w-full border-separate border-spacing-y-2 text-small md:table">
        <caption className="sr-only">Agency members, admins first</caption>
        <thead>
          <tr className="text-left text-micro text-slate-600">
            {["Name", "Role", "Live listings", "Joined"].map((heading) => (
              <th key={heading} scope="col" className="px-4 pb-1 text-micro font-semibold uppercase tracking-wide">
                {heading}
              </th>
            ))}
            <th scope="col" className="px-4 pb-1">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const cell = "bg-canvas px-4 py-3 align-middle first:rounded-l-lg last:rounded-r-lg";
            return (
              <tr key={member.userId}>
                <td className={cell}>
                  <span className="flex items-center gap-3">
                    <Avatar name={member.displayName} baseUrl={member.avatarUrl} size="sm" />
                    <span className="font-medium text-ink">
                      {member.displayName}
                      {member.userId === viewerId && <span className="font-normal text-slate-600"> (you)</span>}
                    </span>
                  </span>
                </td>
                <td className={cell}>
                  <RoleBadge role={member.role} />
                </td>
                <td className={cn(cell, "tabular")}>{member.liveListings}</td>
                <td className={cn(cell, "whitespace-nowrap")}>{formatNairobiDate(member.joinedAt)}</td>
                <td className={cell}>
                  <MemberActions member={member} viewerId={viewerId} isAdmin={isAdmin} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <ul className="flex flex-col gap-3 md:hidden">
        {members.map((member) => (
          <li key={member.userId} className="flex flex-col gap-2 rounded-lg bg-canvas p-4 text-small">
            <div className="flex items-center gap-3">
              <Avatar name={member.displayName} baseUrl={member.avatarUrl} size="sm" />
              <span className="min-w-0 flex-1 font-medium text-ink">
                {member.displayName}
                {member.userId === viewerId && <span className="font-normal text-slate-600"> (you)</span>}
              </span>
              <RoleBadge role={member.role} />
            </div>
            <span className="text-slate-600">
              <span className="tabular">{member.liveListings}</span> live {member.liveListings === 1 ? "listing" : "listings"} · joined{" "}
              {formatNairobiDate(member.joinedAt)}
            </span>
            <MemberActions member={member} viewerId={viewerId} isAdmin={isAdmin} />
          </li>
        ))}
      </ul>
    </section>
  );
}
