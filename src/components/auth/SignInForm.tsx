"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { signInAction } from "@/app/(auth)/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { PasswordInput } from "@/components/forms/PasswordInput";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

export function SignInForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(signInAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const signUpHref = next ? `/sign-up?next=${encodeURIComponent(next)}` : "/sign-up";

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-5">
      {notice && !state.formError && <FormAlert state={{ message: notice }} />}
      <FormAlert state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <Field id="email" label="Email address" error={state.fieldErrors?.email} required>
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
      <Field id="password" label="Password" error={state.fieldErrors?.password} required>
        {(control) => (
          <PasswordInput {...control} name="password" autoComplete="current-password" placeholder="Enter your password" />
        )}
      </Field>
      <Link
        href="/forgot-password"
        className="-mt-2 self-end rounded-sm py-1 text-body-sm font-medium text-emerald-700 underline-offset-4 hover:underline"
      >
        Forgot password?
      </Link>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        Sign in
      </Button>
      <p className="text-body text-ink">
        New here?{" "}
        <Link href={signUpHref} className="font-medium text-emerald-700 underline-offset-4 hover:underline">
          Create an account
        </Link>
      </p>
    </form>
  );
}
