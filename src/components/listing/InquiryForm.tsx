"use client";

import { useActionState, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { sendInquiryAction } from "@/app/properties/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { DEFAULT_INQUIRY_MESSAGE, INQUIRY_MESSAGE_MAX } from "@/lib/validation/engagement";

/** The design's filled inputs; the `line-strong` border stays for 3:1 contrast. */
const FILLED = "bg-canvas";

/**
 * "Request a viewing" (design "03 — Property Detail"; prompt S8 decision 2;
 * prompt ui-design-cards-detail decision 6). Signed-in users only;
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
        {(control) => (
          <Input
            {...control}
            name="fullName"
            autoComplete="name"
            placeholder="Full name"
            defaultValue={values?.fullName ?? defaults.fullName}
            className={FILLED}
          />
        )}
      </Field>
      <Field id="inquiry-phone" label="Phone number" error={state.fieldErrors?.phone}>
        {(control) => (
          <Input
            {...control}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+254 7xx xxx xxx"
            defaultValue={values?.phone ?? ""}
            className={FILLED}
          />
        )}
      </Field>
      {/* Email and message keep their defaults, so name and phone are enough to send. */}
      <details open={Boolean(state.fieldErrors?.email || state.fieldErrors?.message)} className="group">
        <summary className="flex min-h-control cursor-pointer list-none items-center gap-1 text-small font-medium text-emerald-700 hover:text-emerald-600 [&::-webkit-details-marker]:hidden">
          <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          Add an email or a message
        </summary>
        <div className="flex flex-col gap-4 pt-2">
          <Field id="inquiry-email" label="Email" error={state.fieldErrors?.email}>
            {(control) => (
              <Input
                {...control}
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={values?.email ?? defaults.email}
                className={FILLED}
              />
            )}
          </Field>
          <Field id="inquiry-message" label="Message" error={state.fieldErrors?.message} required>
            {(control) => (
              <Textarea
                {...control}
                name="message"
                rows={4}
                maxLength={INQUIRY_MESSAGE_MAX}
                defaultValue={values?.message ?? DEFAULT_INQUIRY_MESSAGE}
                className={FILLED}
              />
            )}
          </Field>
        </div>
      </details>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        Request a viewing
      </Button>
      <p className="text-micro text-slate-600">Your details are shared only with this lister.</p>
    </form>
  );
}
