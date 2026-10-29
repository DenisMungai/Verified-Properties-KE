"use client";

import { useActionState } from "react";
import { submitListingAction } from "@/app/account/listings/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { Button } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

/** Submit for review, or Publish for verified listers. The server decides which actually happens. */
export function SubmitListingForm({
  listingId,
  label,
  disabled,
}: {
  listingId: string;
  label: string;
  disabled?: boolean;
}) {
  const [state, action, pending] = useActionState(submitListingAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormAlert state={state} />
      <input type="hidden" name="listingId" value={listingId} />
      <Button type="submit" size="lg" loading={pending} disabled={disabled} className="w-full sm:w-auto sm:self-start">
        {label}
      </Button>
    </form>
  );
}
