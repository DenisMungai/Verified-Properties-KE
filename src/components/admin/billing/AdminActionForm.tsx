"use client";

import { useActionState, useId, useRef, useState } from "react";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE, type ActionState } from "@/lib/action-state";
import { BILLING_REASON_MAX, BILLING_REASON_MIN } from "@/lib/validation/billing-admin";

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>;

export interface AdminFieldSpec {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  defaultValue?: string;
  inputMode?: "text" | "numeric" | "tel";
  autoCapitalize?: "characters" | "off";
  maxLength?: number;
}

export interface AdminActionFormProps {
  action: Action;
  title: string;
  description?: string;
  /** Ids the action needs (payment, event, subscription). Never amounts or plans. */
  hidden: Record<string, string>;
  fields?: AdminFieldSpec[];
  submitLabel: string;
  variant?: "primary" | "secondary" | "danger";
}

const REASON_HINT = `Admins only. ${BILLING_REASON_MIN}–${BILLING_REASON_MAX} characters: what you checked and why.`;

/**
 * One billing admin action (prompt S10): optional fields, then a required audit reason with a
 * counter. Success redirects with a notice; refusals and field errors show here.
 */
export function AdminActionForm({ action, title, description, hidden, fields = [], submitLabel, variant = "primary" }: AdminActionFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ACTION_STATE);
  const [length, setLength] = useState(state.values?.reason?.length ?? 0);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const uid = useId();
  const headingId = `${uid}-title`;

  return (
    <form ref={formRef} action={formAction} noValidate aria-labelledby={headingId} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 id={headingId} className="text-small font-semibold text-ink">
          {title}
        </h3>
        {description && <p className="text-small text-slate-600">{description}</p>}
      </div>
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormAlert state={state} />
      {fields.map((field) => (
        <Field
          key={field.name}
          id={`${uid}-${field.name}`}
          label={field.label}
          hint={field.hint}
          error={state.fieldErrors?.[field.name]}
          required={field.required}
        >
          {(control) => (
            <Input
              {...control}
              name={field.name}
              inputMode={field.inputMode}
              autoCapitalize={field.autoCapitalize}
              autoComplete="off"
              spellCheck={false}
              maxLength={field.maxLength}
              defaultValue={state.values?.[field.name] ?? field.defaultValue ?? ""}
            />
          )}
        </Field>
      ))}
      <Field id={`${uid}-reason`} label="Reason" hint={REASON_HINT} error={state.fieldErrors?.reason} required>
        {(control) => (
          <Textarea
            {...control}
            name="reason"
            rows={3}
            maxLength={BILLING_REASON_MAX}
            defaultValue={state.values?.reason ?? ""}
            onChange={(event) => setLength(event.target.value.length)}
          />
        )}
      </Field>
      <p aria-live="polite" className="-mt-1 text-micro text-slate-600">
        {length} / {BILLING_REASON_MAX}
      </p>
      <Button type="submit" variant={variant} loading={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
