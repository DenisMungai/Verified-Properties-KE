"use client";

import { useActionState, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import {
  createAgencyAction,
  inviteAgentAction,
  saveAgencyDetailsAction,
  type InviteActionState,
} from "@/app/account/agency/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { MAP_URL_MAX } from "@/lib/listings/map-link";
import { AGENCY_DESCRIPTION_MAX, AGENCY_NAME_MAX } from "@/lib/validation/agency";

/** Create an agency (prompt S23 decision 3). The warning above it is rendered by the server. */
export function CreateAgencyForm() {
  const [state, action, pending] = useActionState(createAgencyAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  return (
    <form ref={formRef} action={action} noValidate className="flex max-w-2xl flex-col gap-5">
      <FormAlert state={state} />
      <Field id="agency-name" label="Agency name" required error={state.fieldErrors?.name}>
        {(control) => <Input {...control} name="name" maxLength={AGENCY_NAME_MAX} autoComplete="organization" defaultValue={state.values?.name ?? ""} />}
      </Field>
      <Field
        id="agency-description"
        label="About the agency"
        hint={`Up to ${AGENCY_DESCRIPTION_MAX} characters. Shown on the agency's page.`}
        error={state.fieldErrors?.description}
      >
        {(control) => <Textarea {...control} name="description" rows={4} maxLength={AGENCY_DESCRIPTION_MAX} defaultValue={state.values?.description ?? ""} />}
      </Field>
      <Button type="submit" size="lg" loading={pending} className="self-start">
        Create agency
      </Button>
    </form>
  );
}

export interface AgencyDetailsDefaults {
  name: string;
  description: string;
  website: string;
  officeMapUrl: string;
}

/** Name, description, website and office map link, for agency admins (decision 8; prompt google-map-links). */
export function AgencyDetailsForm({ defaults }: { defaults: AgencyDetailsDefaults }) {
  const [state, action, pending] = useActionState(saveAgencyDetailsAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const value = (name: keyof AgencyDetailsDefaults) => state.values?.[name] ?? defaults[name];
  return (
    <form ref={formRef} action={action} noValidate className="flex max-w-2xl flex-col gap-5">
      <FormAlert state={state} />
      <Field id="details-name" label="Agency name" required error={state.fieldErrors?.name}>
        {(control) => <Input {...control} name="name" maxLength={AGENCY_NAME_MAX} autoComplete="organization" defaultValue={value("name")} />}
      </Field>
      <Field
        id="details-description"
        label="About the agency"
        hint={`Up to ${AGENCY_DESCRIPTION_MAX} characters.`}
        error={state.fieldErrors?.description}
      >
        {(control) => <Textarea {...control} name="description" rows={4} maxLength={AGENCY_DESCRIPTION_MAX} defaultValue={value("description")} />}
      </Field>
      <Field id="details-website" label="Website" hint="For example https://youragency.co.ke" error={state.fieldErrors?.website}>
        {(control) => <Input {...control} name="website" type="url" inputMode="url" autoComplete="url" defaultValue={value("website")} />}
      </Field>
      <Field
        id="details-office-map"
        label="Office location (Google Maps link)"
        hint="Shown on your agency page. In Google Maps, find your office, tap Share and paste the link."
        error={state.fieldErrors?.officeMapUrl}
      >
        {(control) => (
          <Input
            {...control}
            name="officeMapUrl"
            type="url"
            inputMode="url"
            autoComplete="off"
            maxLength={MAP_URL_MAX}
            placeholder="https://maps.app.goo.gl/…"
            defaultValue={value("officeMapUrl")}
          />
        )}
      </Field>
      <Button type="submit" size="lg" loading={pending} className="self-start">
        Save details
      </Button>
    </form>
  );
}

function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line bg-canvas p-4">
      <label htmlFor="invite-link" className="text-small font-medium text-ink">
        Invite link
      </label>
      <p className="text-micro text-slate-600">
        You can also send this on WhatsApp. It works only for the invited email address and is shown once.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input id="invite-link" readOnly value={url} className="min-w-0 flex-1" onFocus={(event) => event.currentTarget.select()} />
        <Button type="button" variant="secondary" onClick={copy}>
          {copied ? <Check aria-hidden="true" className="size-4" /> : <Copy aria-hidden="true" className="size-4" />}
          {copied ? "Copied" : "Copy invite link"}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? "Invite link copied" : ""}
      </span>
    </div>
  );
}

const ROLE_OPTIONS = [
  { value: "member", label: "Agent" },
  { value: "admin", label: "Admin (manages the agency and its plan)" },
] as const;

/** Invite an agent by email (decision 4); the link is shown once after sending. */
export function InviteForm() {
  const [state, action, pending] = useActionState<InviteActionState, FormData>(inviteAgentAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  // A successful invite clears the email so the next one starts fresh.
  const email = state.ok ? "" : (state.values?.email ?? "");
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <form ref={formRef} action={action} noValidate className="flex flex-col gap-5">
        <FormAlert state={state} />
        <Field
          id="invite-email"
          label="Email address"
          required
          hint="They sign in or sign up with this email to accept."
          error={state.fieldErrors?.email}
        >
          {(control) => <Input {...control} key={state.ok ? "sent" : "draft"} name="email" type="email" autoComplete="off" defaultValue={email} />}
        </Field>
        <Field id="invite-role" label="Role" required error={state.fieldErrors?.role}>
          {(control) => <Select {...control} name="role" options={ROLE_OPTIONS} defaultValue={state.values?.role ?? "member"} />}
        </Field>
        <Button type="submit" size="lg" loading={pending} className="self-start">
          Send invite
        </Button>
      </form>
      {state.inviteUrl && <CopyLink url={state.inviteUrl} />}
    </div>
  );
}
