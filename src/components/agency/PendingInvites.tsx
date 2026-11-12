import { revokeInviteAction } from "@/app/account/agency/actions";
import { Badge, type BadgeTone } from "@/components/ui";
import type { AdminInviteRow, InviteState } from "@/db/queries/agency-invites";
import { formatNairobiDate } from "@/lib/format";
import { ConfirmAction } from "./ConfirmAction";

const STATE: Partial<Record<InviteState, { label: string; tone: BadgeTone }>> = {
  open: { label: "Waiting", tone: "info" },
  expired: { label: "Expired", tone: "neutral" },
  declined: { label: "Declined", tone: "warning" },
};

/** Open, expired and recently declined invites, for agency admins (decision 10). */
export function PendingInvites({ invites }: { invites: AdminInviteRow[] }) {
  if (invites.length === 0) return null;
  return (
    <section aria-labelledby="invites-heading" className="flex flex-col gap-3">
      <h3 id="invites-heading" className="text-small font-semibold text-ink">
        Invites
      </h3>
      <ul className="flex flex-col gap-2">
        {invites.map((invite) => {
          const state = STATE[invite.state] ?? STATE.expired!;
          return (
            <li key={invite.id} className="flex flex-col gap-2 rounded-lg bg-canvas p-4 text-small sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-col gap-1">
                <span className="break-all font-medium text-ink">{invite.email}</span>
                <span className="text-micro text-slate-600">
                  {invite.role === "admin" ? "Admin" : "Agent"} · sent {formatNairobiDate(invite.createdAt)}
                  {invite.state === "open" && ` · expires ${formatNairobiDate(invite.expiresAt)}`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone={state.tone}>{state.label}</Badge>
                {invite.state === "open" && (
                  <ConfirmAction
                    label="Revoke"
                    srLabel={` invite for ${invite.email}`}
                    consequence="The link stops working. You can invite them again later."
                    confirm="Yes, revoke"
                    action={revokeInviteAction}
                    fields={{ inviteId: invite.id }}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
