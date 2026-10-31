"use client";

import Link from "next/link";
import { useActionState, useRef } from "react";
import { signUpAction } from "@/app/(auth)/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { PasswordInput } from "@/components/forms/PasswordInput";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input, SegmentedControl } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { PASSWORD_MIN } from "@/lib/validation/auth";

const INTENTS = [
  { value: "find", label: "Find a property" },
  { value: "list", label: "List property" },
] as const;

export function SignUpForm({ next, defaultIntent = "find" }: { next?: string; defaultIntent?: "find" | "list" }) {
  const [state, action, pending] = useActionState(signUpAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const signInHref = next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";
  const intent = state.values?.intent === "list" || state.values?.intent === "find" ? state.values.intent : defaultIntent;

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-5">
      <FormAlert state={state} />
      {next && <input type="hidden" name="next" value={next} />}
      <div className="flex flex-col gap-2">
        {/* key resets the uncontrolled radios to the submitted value after an error */}
        <SegmentedControl
          key={intent}
          legend="What brings you here?"
          legendClassName="mb-2 text-small font-medium text-ink"
          name="intent"
          defaultValue={intent}
          options={INTENTS}
        />
        {state.fieldErrors?.intent && <p className="text-micro font-medium text-danger">{state.fieldErrors.intent}</p>}
      </div>
      <Field id="name" label="Full name" error={state.fieldErrors?.name} required>
        {(control) => <Input {...control} name="name" autoComplete="name" defaultValue={state.values?.name} />}
      </Field>
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
      <Field
        id="password"
        label="Password"
        hint={`At least ${PASSWORD_MIN} characters. A short phrase is easier to remember and harder to guess.`}
        error={state.fieldErrors?.password}
        required
      >
        {(control) => <PasswordInput {...control} name="password" autoComplete="new-password" />}
      </Field>
      <p className="text-micro text-slate-600">
        By creating an account you agree to use VerifiedPropertiesKE honestly. Our terms and privacy notice will be
        published before launch.
      </p>
      <Button type="submit" size="lg" loading={pending} className="w-full">
        Create account
      </Button>
      <p className="text-body text-ink">
        Already have an account?{" "}
        <Link href={signInHref} className="font-medium text-emerald-700 underline-offset-4 hover:underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
