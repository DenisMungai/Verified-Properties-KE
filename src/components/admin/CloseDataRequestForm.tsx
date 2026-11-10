"use client";

import { useActionState, useRef, useState } from "react";
import { closeDataRequestAction } from "@/app/admin/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { DATA_REQUEST_NOTE_MAX } from "@/lib/legal";

/** Close a data request with a note the user sees (prompt S20 UI spec). Success redirects. */
export function CloseDataRequestForm({ requestId }: { requestId: string }) {
  const [state, action, pending] = useActionState(closeDataRequestAction, INITIAL_ACTION_STATE);
  const [length, setLength] = useState(state.values?.note?.length ?? 0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  return (
    <details className="group rounded-lg border border-line bg-white open:p-4">
      <summary className="inline-flex min-h-control cursor-pointer list-none items-center rounded-md px-3 text-small font-semibold text-emerald-700 hover:underline group-open:mb-2 group-open:px-0 [&::-webkit-details-marker]:hidden">
        Close with a note
      </summary>
      <form ref={formRef} action={action} noValidate className="flex flex-col gap-3">
        <input type="hidden" name="requestId" value={requestId} />
        <FormAlert state={state} />
        <Field
          id={`note-${requestId}`}
          label="Note to the user"
          hint="The user sees this under their request. Say what you did, or what we must keep and why."
          error={state.fieldErrors?.note}
          required
        >
          {(control) => (
            <Textarea
              {...control}
              name="note"
              rows={3}
              maxLength={DATA_REQUEST_NOTE_MAX}
              defaultValue={state.values?.note ?? ""}
              onChange={(event) => setLength(event.target.value.length)}
            />
          )}
        </Field>
        <p aria-live="polite" className="-mt-1 text-micro text-slate-600">
          {length} / {DATA_REQUEST_NOTE_MAX}
        </p>
        <Button type="submit" loading={pending} className="self-start">
          Close request
        </Button>
      </form>
    </details>
  );
}
