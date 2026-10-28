"use client";

import { useActionState, useRef } from "react";
import { resetPasswordAction } from "@/app/(auth)/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { PasswordInput } from "@/components/forms/PasswordInput";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { PASSWORD_MIN } from "@/lib/validation/auth";

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-5">
      <FormAlert state={state} />
      <input type="hidden" name="token" value={token} />
      <Field
        id="password"
        label="New password"
        hint={`At least ${PASSWORD_MIN} characters.`}
        error={state.fieldErrors?.password}
        required
      >
        {(control) => <PasswordInput {...control} name="password" autoComplete="new-password" />}
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={state.fieldErrors?.confirmPassword} required>
        {(control) => <PasswordInput {...control} name="confirmPassword" autoComplete="new-password" />}
      </Field>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        Set new password
      </Button>
    </form>
  );
}
