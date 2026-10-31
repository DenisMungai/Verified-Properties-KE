"use client";

import { useActionState, useRef } from "react";
import { sendInquiryAction } from "@/app/properties/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { DEFAULT_INQUIRY_MESSAGE, INQUIRY_MESSAGE_MAX } from "@/lib/validation/engagement";

/**
 * "Request a viewing" (design "03 — Property Detail"; prompt S8 decision 2). Signed-in users only;
 * the server re-checks everything. After a send the page refreshes, so the lister panel can show
 * the contact details the inquiry unlocked.
 */
export function InquiryForm({
  listingId,
  defaults,
}: {
  listingId: string;
  defaults: { fullName: string; email: string };
}) {
  const [state, action, pending] = useActionState(sendInquiryAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const values = state.ok ? undefined : state.values;

  return (
    // key: after a successful send the form remounts with fresh defaults.
    <form key={state.ok ? `sent-${state.message}` : "editing"} ref={formRef} action={action} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="listingId" value={listingId} />
      <FormAlert state={state} />
      <Field id="inquiry-name" label="Your name" error={state.fieldErrors?.fullName} required>
        {(control) => <Input {...control} name="fullName" autoComplete="name" defaultValue={values?.fullName ?? defaults.fullName} />}
      </Field>
      <Field id="inquiry-phone" label="Phone number" hint="So the lister can call you back." error={state.fieldErrors?.phone}>
        {(control) => (
          <Input
            {...control}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="07xx xxx xxx"
            defaultValue={values?.phone ?? ""}
          />
        )}
      </Field>
      <Field id="inquiry-email" label="Email" error={state.fieldErrors?.email}>
        {(control) => (
          <Input {...control} name="email" type="email" autoComplete="email" defaultValue={values?.email ?? defaults.email} />
        )}
      </Field>
      <Field id="inquiry-message" label="Message" error={state.fieldErrors?.message} required>
        {(control) => (
          <Textarea {...control} name="message" rows={4} maxLength={INQUIRY_MESSAGE_MAX} defaultValue={values?.message ?? DEFAULT_INQUIRY_MESSAGE} />
        )}
      </Field>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        Request a viewing
      </Button>
      <p className="text-micro text-slate-600">Your details are shared only with this lister.</p>
    </form>
  );
}
