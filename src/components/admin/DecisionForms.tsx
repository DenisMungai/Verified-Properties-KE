"use client";

import { useActionState, useRef, useState } from "react";
import { approveListingAction, dismissReportAction, rejectListingAction, takeDownAction } from "@/app/admin/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { DECISION_REASON_MAX, DECISION_REASON_MIN } from "@/lib/validation/engagement";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** One-click decision (approve, dismiss). Success redirects with a notice; failures show here. */
function SimpleDecision({ action, idName, id, label, variant }: { action: Action; idName: string; id: string; label: string; variant: "primary" | "secondary" }) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_STATE);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name={idName} value={id} />
      <FormAlert state={state} />
      <Button type="submit" variant={variant} loading={pending} className="self-start">
        {label}
      </Button>
    </form>
  );
}

/** Decision with a reason the lister will see (reject, take down). */
function ReasonDecision({
  action,
  idName,
  id,
  label,
  fieldLabel,
  hint,
}: {
  action: Action;
  idName: string;
  id: string;
  label: string;
  fieldLabel: string;
  hint: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_STATE);
  const [length, setLength] = useState(state.values?.reason?.length ?? 0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const fieldId = `${idName}-${id}-reason`;
  return (
    <form ref={formRef} action={formAction} noValidate className="flex flex-col gap-3">
      <input type="hidden" name={idName} value={id} />
      <FormAlert state={state} />
      <Field id={fieldId} label={fieldLabel} hint={hint} error={state.fieldErrors?.reason} required>
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            rows={3}
            maxLength={DECISION_REASON_MAX}
            defaultValue={state.values?.reason ?? ""}
            onChange={(event) => setLength(event.target.value.length)}
          />
        )}
      </Field>
      <p aria-live="polite" className="-mt-1 text-micro text-slate-600">
        {length} / {DECISION_REASON_MAX}
      </p>
      <Button type="submit" variant="danger" loading={pending} className="self-start">
        {label}
      </Button>
    </form>
  );
}

const REASON_HINT = `The lister sees this. ${DECISION_REASON_MIN}–${DECISION_REASON_MAX} characters: say what to fix.`;

export function ApproveForm({ listingId }: { listingId: string }) {
  return <SimpleDecision action={approveListingAction} idName="listingId" id={listingId} label="Approve and publish" variant="primary" />;
}

export function RejectForm({ listingId }: { listingId: string }) {
  return (
    <ReasonDecision
      action={rejectListingAction}
      idName="listingId"
      id={listingId}
      label="Reject listing"
      fieldLabel="Reason for rejecting"
      hint={REASON_HINT}
    />
  );
}

export function DismissReportForm({ reportId }: { reportId: string }) {
  return <SimpleDecision action={dismissReportAction} idName="reportId" id={reportId} label="Dismiss report" variant="secondary" />;
}

export function TakeDownForm({ reportId }: { reportId: string }) {
  return (
    <ReasonDecision
      action={takeDownAction}
      idName="reportId"
      id={reportId}
      label="Take listing down"
      fieldLabel="Reason for taking it down"
      hint={REASON_HINT}
    />
  );
}
