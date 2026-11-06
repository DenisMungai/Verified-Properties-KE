"use client";

import { useActionState, useRef, useState } from "react";
import {
  approveVerificationAction,
  rejectVerificationAction,
  requestChangesAction,
  suspendVerificationAction,
} from "@/app/admin/verification/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { DECISION_REASON_MAX, DECISION_REASON_MIN } from "@/lib/validation/engagement";
import { REVIEW_CHECKLIST } from "@/lib/verification/rules";

const REASON_HINT = `Needed to request changes or reject. The lister sees it: ${DECISION_REASON_MIN}–${DECISION_REASON_MAX} characters.`;

/** The most recent of several action states (each button has its own action). */
function latest(...states: ActionState[]): ActionState {
  return states.find((s) => s.formError || s.fieldErrors) ?? INITIAL_ACTION_STATE;
}

/**
 * Design "05 — Verification Review": checklist, reviewer notes and the decision buttons. Approve
 * stays disabled until every checklist item is ticked; the server checks the same four items.
 * Reject and the fee credit sit behind a confirm step. Below `lg` the two main buttons ride in a
 * bottom bar (`data-mobile-bar`).
 */
export function ReviewPanel({ requestId }: { requestId: string }) {
  const [approveState, approve, approving] = useActionState(approveVerificationAction, INITIAL_ACTION_STATE);
  const [changesState, changes, requesting] = useActionState(requestChangesAction, INITIAL_ACTION_STATE);
  const [rejectState, reject, rejecting] = useActionState(rejectVerificationAction, INITIAL_ACTION_STATE);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const [confirmReject, setConfirmReject] = useState(false);
  const [length, setLength] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const state = latest(approveState, changesState, rejectState);
  useFocusFirstError(formRef, state);

  const allTicked = REVIEW_CHECKLIST.every((item) => ticked[item.name]);
  const busy = approving || requesting || rejecting;
  const values = changesState.values ?? rejectState.values;

  return (
    <form ref={formRef} noValidate className="flex flex-col gap-6">
      <input type="hidden" name="requestId" value={requestId} />
      <FormAlert state={state.formError ? state : INITIAL_ACTION_STATE} />

      <fieldset className="flex flex-col gap-1 rounded-lg border border-line bg-white p-5">
        <legend className="float-left mb-2 text-title">Review checklist</legend>
        {REVIEW_CHECKLIST.map((item) => {
          const id = `check-${item.name}`;
          return (
            <label key={item.name} htmlFor={id} className="flex min-h-control cursor-pointer items-center gap-3 text-small text-ink">
              <input
                id={id}
                type="checkbox"
                name={item.name}
                checked={ticked[item.name] ?? false}
                onChange={(event) => setTicked((prev) => ({ ...prev, [item.name]: event.target.checked }))}
                className="size-5 shrink-0 rounded border-line-strong accent-emerald-600"
              />
              {item.label}
            </label>
          );
        })}
      </fieldset>

      <div className="flex flex-col gap-2 rounded-lg border border-line bg-white p-5">
        <h2 className="text-title">Reviewer notes</h2>
        <Field id={`reason-${requestId}`} label="Reason for the lister" hint={REASON_HINT} error={state.fieldErrors?.reason}>
          {(control) => (
            <Textarea
              {...control}
              name="reason"
              rows={4}
              maxLength={DECISION_REASON_MAX}
              defaultValue={values?.reason ?? ""}
              placeholder="Add a reason, e.g. the ID photo is blurred; please upload a clearer scan."
              onChange={(event) => setLength(event.target.value.length)}
            />
          )}
        </Field>
        <p aria-live="polite" className="text-micro text-slate-600">
          {length} / {DECISION_REASON_MAX}
        </p>
        <div className="mt-2 flex flex-col gap-3 border-t border-line pt-4">
          {confirmReject ? (
            <div role="group" aria-label="Confirm rejection" className="flex flex-col gap-3 rounded-sm bg-danger-tint p-3">
              <p className="text-small text-danger">
                Rejecting ends this review. The fee is credited to the lister&apos;s listing plan, or flagged for a refund if it can&apos;t be.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button type="submit" variant="danger" formAction={reject} loading={rejecting} disabled={busy}>
                  Reject and credit fee
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmReject(false)} disabled={busy}>
                  Keep reviewing
                </Button>
              </div>
            </div>
          ) : (
            <Button type="button" variant="ghost" className="self-start px-3 text-danger hover:bg-danger-tint" onClick={() => setConfirmReject(true)} disabled={busy}>
              Reject verification…
            </Button>
          )}
        </div>
      </div>

      <div
        data-mobile-bar
        className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--vp-mobile-bar-height)] items-center border-t border-line bg-white px-4 lg:static lg:h-auto lg:justify-end lg:border-0 lg:bg-transparent lg:px-0"
      >
        <div className="mx-auto flex w-full max-w-page items-center gap-3 lg:mx-0 lg:w-auto">
          <Button
            type="submit"
            variant="secondary"
            formAction={changes}
            loading={requesting}
            disabled={busy}
            className="flex-1 border-danger text-danger hover:border-danger hover:bg-danger-tint lg:flex-none"
          >
            Request changes
          </Button>
          <Button type="submit" formAction={approve} loading={approving} disabled={busy || !allTicked} className="flex-1 lg:flex-none">
            Approve verification
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Suspend a verified lister's badge (decision 8), behind a confirm step with a reason. */
export function SuspendPanel({ requestId }: { requestId: string }) {
  const [state, suspend, pending] = useActionState(suspendVerificationAction, INITIAL_ACTION_STATE);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  if (!open && !state.formError && !state.fieldErrors) {
    return (
      <Button type="button" variant="ghost" className="self-start px-3 text-danger hover:bg-danger-tint" onClick={() => setOpen(true)}>
        Suspend badge…
      </Button>
    );
  }
  return (
    <form ref={formRef} action={suspend} noValidate className="flex flex-col gap-3">
      <input type="hidden" name="requestId" value={requestId} />
      <FormAlert state={state} />
      <Field id={`suspend-${requestId}`} label="Reason for suspending" hint={`The lister sees this. ${DECISION_REASON_MIN}–${DECISION_REASON_MAX} characters.`} error={state.fieldErrors?.reason} required>
        {(control) => <Textarea {...control} name="reason" rows={3} maxLength={DECISION_REASON_MAX} defaultValue={state.values?.reason ?? ""} />}
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="danger" loading={pending}>
          Suspend badge
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
