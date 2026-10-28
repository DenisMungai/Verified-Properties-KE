"use client";

import { useActionState, useRef } from "react";
import { changePasswordAction, signOutEverywhereAction, updateNameAction } from "@/app/account/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { PasswordInput } from "@/components/forms/PasswordInput";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { PASSWORD_MIN } from "@/lib/validation/auth";

export function NameForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateNameAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-4">
      <FormAlert state={state} />
      <Field id="name" label="Full name" error={state.fieldErrors?.name} required>
        {(control) => <Input {...control} name="name" autoComplete="name" defaultValue={state.values?.name ?? name} />}
      </Field>
      <Button type="submit" variant="secondary" loading={pending} className="self-start">
        Save name
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  return (
    // key remounts the form after success so the password fields are cleared.
    <form key={state.ok ? "done" : "editing"} ref={formRef} action={action} noValidate className="flex flex-col gap-4">
      <FormAlert state={state} />
      <Field id="currentPassword" label="Current password" error={state.fieldErrors?.currentPassword} required>
        {(control) => <PasswordInput {...control} name="currentPassword" autoComplete="current-password" />}
      </Field>
      <Field
        id="newPassword"
        label="New password"
        hint={`At least ${PASSWORD_MIN} characters.`}
        error={state.fieldErrors?.newPassword}
        required
      >
        {(control) => <PasswordInput {...control} name="newPassword" autoComplete="new-password" />}
      </Field>
      <Field id="confirmPassword" label="Confirm new password" error={state.fieldErrors?.confirmPassword} required>
        {(control) => <PasswordInput {...control} name="confirmPassword" autoComplete="new-password" />}
      </Field>
      <Button type="submit" variant="secondary" loading={pending} className="self-start">
        Change password
      </Button>
    </form>
  );
}

export function SignOutEverywhereForm() {
  return (
    <form action={signOutEverywhereAction}>
      <Button type="submit" variant="secondary">
        Sign out of all devices
      </Button>
    </form>
  );
}
