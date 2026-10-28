"use client";

import { useActionState, useRef } from "react";
import { saveListerProfileAction } from "@/app/account/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { useFocusFirstError } from "@/components/forms/useFocusFirstError";
import { Button, Field, Input, SegmentedControl, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { LISTER_TYPES, LISTER_TYPE_LABELS, type ListerType } from "@/lib/roles";

export interface ListerProfileDefaults {
  listerType: ListerType;
  displayName: string;
  phone: string;
  publicEmail: string;
  bio: string;
}

const TYPE_OPTIONS = LISTER_TYPES.map((value) => ({ value, label: LISTER_TYPE_LABELS[value] }));

/** Onboarding (redirects to the overview) and "Listing profile" (stays, shows a message). */
export function ListerProfileForm({
  defaults,
  redirectTo,
  submitLabel,
}: {
  defaults: ListerProfileDefaults;
  redirectTo: "overview" | "stay";
  submitLabel: string;
}) {
  const [state, action, pending] = useActionState(saveListerProfileAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusFirstError(formRef, state);
  const value = (name: keyof ListerProfileDefaults) => state.values?.[name] ?? defaults[name];
  const listerType = (LISTER_TYPES as readonly string[]).includes(value("listerType"))
    ? (value("listerType") as ListerType)
    : defaults.listerType;

  return (
    <form ref={formRef} action={action} noValidate className="flex max-w-2xl flex-col gap-6">
      <FormAlert state={state} />
      <input type="hidden" name="redirectTo" value={redirectTo} />
      <div className="flex flex-col gap-2">
        <SegmentedControl
          key={listerType}
          legend="I list property as"
          legendClassName="mb-2 text-body-sm font-medium text-ink"
          name="listerType"
          defaultValue={listerType}
          options={TYPE_OPTIONS}
        />
        {state.fieldErrors?.listerType && (
          <p className="text-caption font-medium text-danger">{state.fieldErrors.listerType}</p>
        )}
      </div>
      <Field
        id="displayName"
        label="Display name"
        hint="Your name or your business name, as buyers will see it."
        error={state.fieldErrors?.displayName}
        required
      >
        {(control) => (
          <Input {...control} name="displayName" autoComplete="organization" defaultValue={value("displayName")} />
        )}
      </Field>
      <Field
        id="phone"
        label="Phone number"
        hint="Kenyan mobile, for example 0712 345 678. Shown to buyers after they send a signed-in inquiry."
        error={state.fieldErrors?.phone}
        required
      >
        {(control) => (
          <Input
            {...control}
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={value("phone")}
          />
        )}
      </Field>
      <Field
        id="publicEmail"
        label="Public email"
        hint="Leave blank to keep your account email private."
        error={state.fieldErrors?.publicEmail}
      >
        {(control) => (
          <Input {...control} name="publicEmail" type="email" autoComplete="email" defaultValue={value("publicEmail")} />
        )}
      </Field>
      <Field id="bio" label="About you" hint="Up to 600 characters." error={state.fieldErrors?.bio}>
        {(control) => <Textarea {...control} name="bio" maxLength={600} defaultValue={value("bio")} />}
      </Field>
      <Button type="submit" size="lg" loading={pending} className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
