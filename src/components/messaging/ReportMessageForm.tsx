"use client";

import { useActionState, useId, useRef } from "react";
import { reportMessageAction } from "@/app/account/messages/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { REPORT_DETAILS_MAX } from "@/lib/validation/engagement";
import { MESSAGE_REPORT_REASONS, MESSAGE_REPORT_REASON_LABELS } from "@/lib/validation/messaging";

const REASON_OPTIONS = MESSAGE_REPORT_REASONS.map((reason) => ({ value: reason, label: MESSAGE_REPORT_REASON_LABELS[reason] }));

/**
 * "Report" under the other person's message (prompt S15 decision 12), behind a <details>
 * disclosure so it works without JavaScript or the Popover API. "Also block" is ticked by default.
 * Always rendered for the other person's messages, so the confirmation survives the refresh that
 * follows a report; on a fresh load an already-reported message just says "Reported".
 */
export function ReportMessageForm({ messageId, reported }: { messageId: string; reported: boolean }) {
  const [state, action, pending] = useActionState(reportMessageAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const ids = useId();
  useFocusFirstError(formRef, state);

  if (reported && !state.ok) return <span className="text-micro text-slate-600">Reported</span>;
  return (
    <details className="group">
      <summary className="-my-1.5 inline-flex min-h-control-sm cursor-pointer list-none items-center rounded-md px-1 text-micro font-medium text-slate-600 hover:text-ink [&::-webkit-details-marker]:hidden">
        Report
      </summary>
      {state.ok ? (
        <FormAlert state={state} className="mt-2" />
      ) : (
        <form ref={formRef} action={action} noValidate className="mt-2 flex w-full flex-col gap-3 rounded-lg border border-line bg-white p-4 sm:w-96">
          <input type="hidden" name="messageId" value={messageId} />
          <FormAlert state={state} />
          <Field id={`${ids}-reason`} label="What's wrong?" error={state.fieldErrors?.reason} required>
            {(control) => (
              <Select {...control} name="reason" options={REASON_OPTIONS} placeholder="Choose a reason" defaultValue={state.values?.reason ?? ""} />
            )}
          </Field>
          <Field id={`${ids}-details`} label="Details" hint="Optional. Anything that helps our team check it." error={state.fieldErrors?.details}>
            {(control) => <Textarea {...control} name="details" rows={2} maxLength={REPORT_DETAILS_MAX} defaultValue={state.values?.details ?? ""} />}
          </Field>
          <label className="flex min-h-control items-center gap-3 text-small text-ink">
            <input type="checkbox" name="block" defaultChecked className="size-5 accent-emerald-600" />
            Also block this person
          </label>
          <Button type="submit" variant="secondary" loading={pending} className="self-start">
            Send report
          </Button>
        </form>
      )}
    </details>
  );
}
