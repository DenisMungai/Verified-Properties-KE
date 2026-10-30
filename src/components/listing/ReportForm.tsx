"use client";

import { useActionState, useRef } from "react";
import { Flag } from "lucide-react";
import { reportListingAction } from "@/app/properties/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { REPORT_DETAILS_MAX, REPORT_REASONS, REPORT_REASON_LABELS } from "@/lib/validation/engagement";

const REASON_OPTIONS = REPORT_REASONS.map((reason) => ({ value: reason, label: REPORT_REASON_LABELS[reason] }));

/**
 * "Report listing" behind a <details> disclosure, so it opens without JavaScript
 * (prompt S8 decision 5). Signed-in users only; the page shows a sign-in link otherwise.
 */
export function ReportForm({ listingId }: { listingId: string }) {
  const [state, action, pending] = useActionState(reportListingAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  return (
    <details className="group w-full rounded-lg border border-line bg-white open:p-4 sm:w-auto">
      <summary className="inline-flex min-h-control cursor-pointer list-none items-center gap-2 rounded-md px-3 text-button text-slate-700 hover:text-ink group-open:mb-2 group-open:px-0 [&::-webkit-details-marker]:hidden">
        <Flag aria-hidden="true" className="size-4" />
        Report listing
      </summary>
      {state.ok ? (
        <FormAlert state={state} />
      ) : (
        <form ref={formRef} action={action} noValidate className="flex w-full flex-col gap-4 sm:w-96">
          <input type="hidden" name="listingId" value={listingId} />
          <FormAlert state={state} />
          <Field id="report-reason" label="What's wrong?" error={state.fieldErrors?.reason} required>
            {(control) => (
              <Select {...control} name="reason" options={REASON_OPTIONS} placeholder="Choose a reason" defaultValue={state.values?.reason ?? ""} />
            )}
          </Field>
          <Field id="report-details" label="Details" hint="Anything that helps our team check it." error={state.fieldErrors?.details}>
            {(control) => (
              <Textarea {...control} name="details" rows={3} maxLength={REPORT_DETAILS_MAX} defaultValue={state.values?.details ?? ""} />
            )}
          </Field>
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            Send report
          </Button>
        </form>
      )}
    </details>
  );
}
