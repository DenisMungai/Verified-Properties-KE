"use client";

import { useActionState, useRef, useState } from "react";
import { createDataRequestAction } from "@/app/privacy/request/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { cn } from "@/lib/cn";
import { DATA_REQUEST_DETAILS_MAX, DATA_REQUEST_KINDS, DATA_REQUEST_KIND_LABELS } from "@/lib/legal";

/** The request form (prompt S20 UI spec): six kinds as 44px radio rows, details with a counter. */
export function DataRequestForm() {
  const [state, action, pending] = useActionState(createDataRequestAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const errors = state.ok ? {} : (state.fieldErrors ?? {});
  const kept = state.ok ? undefined : state.values;
  const [details, setDetails] = useState(kept?.details ?? "");
  // Clear the details once per successful send (state adjusted during render, not in an effect).
  const [clearedFor, setClearedFor] = useState<string | undefined>();
  if (state.ok && state.message !== clearedFor) {
    setClearedFor(state.message);
    setDetails("");
  }

  return (
    <form
      ref={formRef}
      action={action}
      noValidate
      // A new key after success clears the form for the next request.
      key={state.ok ? state.message : "form"}
      className="flex flex-col gap-5 rounded-sm border border-line bg-white p-5"
    >
      <FormAlert state={state} />
      <fieldset className="flex flex-col gap-2" aria-describedby={errors.kind ? "kind-error" : undefined}>
        <legend className="mb-2 text-small font-medium text-ink">What do you want to do?</legend>
        {DATA_REQUEST_KINDS.map((kind) => {
          const id = `kind-${kind}`;
          return (
            <label
              key={kind}
              htmlFor={id}
              className={cn(
                "flex min-h-control cursor-pointer items-start gap-3 rounded-lg border border-line-strong p-3 hover:border-ink",
                "has-[:checked]:border-emerald-600 has-[:checked]:bg-mint-50",
              )}
            >
              <input
                type="radio"
                id={id}
                name="kind"
                value={kind}
                defaultChecked={kept?.kind === kind}
                className="mt-1 size-4 shrink-0 accent-emerald-600"
              />
              <span className="flex flex-col">
                <span className="text-small font-medium text-ink">{DATA_REQUEST_KIND_LABELS[kind].label}</span>
                <span className="text-micro text-slate-600">{DATA_REQUEST_KIND_LABELS[kind].hint}</span>
              </span>
            </label>
          );
        })}
        {errors.kind && (
          <p id="kind-error" className="text-micro font-medium text-danger">
            {errors.kind}
          </p>
        )}
      </fieldset>

      <Field
        id="details"
        label="Details"
        hint={`${details.length} of ${DATA_REQUEST_DETAILS_MAX} characters. For billing, include the invoice number or M-Pesa receipt.`}
        error={errors.details}
        required
      >
        {(control) => (
          <Textarea
            {...control}
            name="details"
            maxLength={DATA_REQUEST_DETAILS_MAX}
            value={details}
            onChange={(event) => setDetails(event.target.value)}
          />
        )}
      </Field>

      <Button type="submit" loading={pending} className="self-start">
        Send request
      </Button>
    </form>
  );
}
