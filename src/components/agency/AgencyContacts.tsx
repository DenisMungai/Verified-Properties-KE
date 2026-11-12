import { AgencyContactForm } from "@/components/account/AgencyContactForm";
import type { AgencyContactView } from "@/db/queries/agency-contacts";
import { displayKenyanPhone } from "@/lib/kenya";

/**
 * Office contacts shown under the agent's on the agency's listings (prompt lister-contact-buttons
 * decision 10), on Account → Agency since prompt S23. Admins edit; members read.
 */
export function AgencyContacts({ agency }: { agency: AgencyContactView }) {
  const rows = [
    ["Office phone", agency.phone && displayKenyanPhone(agency.phone)],
    ["WhatsApp", agency.whatsapp && displayKenyanPhone(agency.whatsapp)],
    ["Office email", agency.email],
  ] as const;
  return (
    <section aria-labelledby="agency-contacts" className="flex flex-col gap-4 rounded-lg border border-line bg-white p-5 md:p-6">
      <div className="flex flex-col gap-1">
        <h2 id="agency-contacts" className="text-title">
          Office contacts
        </h2>
        <p className="text-small text-slate-600">
          They appear under each agent&apos;s own contacts on the agency&apos;s listings and page.
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
