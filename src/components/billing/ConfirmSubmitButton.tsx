"use client";

import { useFormStatus } from "react-dom";
import { Button, type ButtonVariant } from "@/components/ui";

/** The final confirm button inside a Server Action form: spinner and no double submit while it runs. */
export function ConfirmSubmitButton({ label, variant }: { label: string; variant: ButtonVariant }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} loading={pending} className="w-full md:w-auto">
      {label}
    </Button>
  );
}
