"use client";

import { useActionState, useRef } from "react";
import { forgotPasswordAction, resendVerificationAction } from "@/app/(auth)/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

const ACTIONS = {
  "forgot-password": { action: forgotPasswordAction, submit: "Send reset link", variant: "primary" },
  "resend-verification": { action: resendVerificationAction, submit: "Resend email", variant: "secondary" },
} as const;

/** One email field: password-reset request or resend-verification. Responses are always generic. */
export function EmailOnlyForm({ kind }: { kind: keyof typeof ACTIONS }) {
  const config = ACTIONS[kind];
  const [state, action, pending] = useActionState(config.action, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-5">
      <FormAlert state={state} />
      <Field id={`${kind}-email`} label="Email address" error={state.fieldErrors?.email} required>
        {(control) => (
          <Input
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            defaultValue={state.values?.email}
          />
        )}
      </Field>
      <Button type="submit" variant={config.variant} size="lg" loading={pending} className="w-full">
        {config.submit}
      </Button>
    </form>
  );
}
