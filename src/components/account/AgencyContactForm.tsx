"use client";

import { useActionState, useRef } from "react";
import { saveAgencyContactAction } from "@/app/account/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { WhatsappFields } from "./WhatsappFields";

export interface AgencyContactDefaults {
  phone: string;
  whatsappSameAsPhone: boolean;
  whatsapp: string;
  email: string;
}

/** The agency office's Call, WhatsApp and Email details, edited by an agency admin. */
export function AgencyContactForm({ defaults }: { defaults: AgencyContactDefaults }) {
  const [state, action, pending] = useActionState(saveAgencyContactAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const value = (name: "phone" | "whatsapp" | "email") => state.values?.[name] ?? defaults[name];
  const sameAsPhone = state.values ? state.values.whatsappSameAsPhone === "on" : defaults.whatsappSameAsPhone;

  return (
    <form ref={formRef} action={action} noValidate className="flex max-w-2xl flex-col gap-6">
      <FormAlert state={state} />
      <Field
        id="agency-phone"
        label="Office phone"
        hint="Kenyan mobile, for example 0712 345 678. Leave blank for no office Call button."
        error={state.fieldErrors?.phone}
      >
        {(control) => <Input {...control} name="phone" type="tel" inputMode="tel" autoComplete="tel" defaultValue={value("phone")} />}
      </Field>
      <WhatsappFields
        idPrefix="agency-"
        sameAsPhone={sameAsPhone}
        value={value("whatsapp")}
        error={state.fieldErrors?.whatsapp}
        phoneWord="office phone"
      />
      <Field
        id="agency-email"
        label="Office email"
        hint="Leave blank for no office Email button."
        error={state.fieldErrors?.email}
      >
        {(control) => <Input {...control} name="email" type="email" autoComplete="email" defaultValue={value("email")} />}
      </Field>
      <Button type="submit" size="lg" loading={pending} className="self-start">
        Save agency contacts
      </Button>
    </form>
  );
}
