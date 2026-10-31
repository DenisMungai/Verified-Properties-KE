import { CircleAlert, CircleCheck } from "lucide-react";
import type { ActionState } from "@/lib/action-state";
import { cn } from "@/lib/cn";

/**
 * Form-level message. Errors use role="alert" so they are announced after a failed submit;
 * success messages use role="status". Text plus icon, never colour alone.
 */
export function FormAlert({ state, className }: { state: ActionState; className?: string }) {
  if (state.formError) {
    return (
      <p
        role="alert"
        className={cn(
          "flex items-start gap-2 rounded-md bg-danger-tint px-4 py-3 text-small font-medium text-danger",
          className,
        )}
      >
        <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {state.formError}
      </p>
    );
  }
  if (state.message) {
    return (
      <p
        role="status"
        className={cn("flex items-start gap-2 rounded-md bg-mint-50 px-4 py-3 text-small font-medium text-success", className)}
      >
        <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {state.message}
      </p>
    );
  }
  return null;
}
