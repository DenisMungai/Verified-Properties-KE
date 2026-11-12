import { acceptInviteAction, declineInviteAction } from "@/app/account/agency/actions";
import { ConfirmSubmitButton } from "@/components/billing/ConfirmSubmitButton";
import { Avatar } from "@/components/ui";
import { JoinWarning } from "./JoinWarning";

/**
 * An open invite with its warning and Accept / Decline (prompt S23 decisions 4 and 6). The form
 * carries the email link's token or, on the account page, the invite id; the server checks the
 * invite is addressed to the signed-in user either way.
 */
export function InviteCard({
  agencyName,
  logoUrl,
  inviterName,
  role,
  expiresOn,
  warning,
  invite,
}: {
  agencyName: string;
  logoUrl: string | null;
  inviterName: string | null;
  role: "admin" | "member";
  expiresOn: string;
  warning: string[];
  invite: { token: string } | { inviteId: string };
}) {
  const hidden = "token" in invite ? { name: "token", value: invite.token } : { name: "inviteId", value: invite.inviteId };
  return (
    <section className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5 md:p-6" aria-label={`Invite from ${agencyName}`}>
      <div className="flex items-center gap-3">
        <Avatar name={agencyName} baseUrl={logoUrl} size="md" />
        <div className="flex min-w-0 flex-col">
          <h2 className="text-title">{agencyName}</h2>
          <p className="text-small text-slate-600">
            {inviterName ? `${inviterName} invited you` : "You're invited"} to join as {role === "admin" ? "an admin" : "an agent"}. Expires{" "}
            {expiresOn}.
          </p>
        </div>
      </div>
      <JoinWarning heading="Before you join" lines={warning} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <form action={acceptInviteAction}>
          <input type="hidden" name={hidden.name} value={hidden.value} />
          <ConfirmSubmitButton label={`Join ${agencyName}`} variant="primary" />
        </form>
        <form action={declineInviteAction}>
          <input type="hidden" name={hidden.name} value={hidden.value} />
          <ConfirmSubmitButton label="Decline" variant="secondary" />
        </form>
      </div>
    </section>
  );
}
