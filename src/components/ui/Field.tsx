import type { ReactNode } from "react";
import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

/** Props a control needs to be labelled and described by its Field. */
export interface FieldControlProps {
  id: string;
  required?: boolean;
  "aria-invalid"?: true;
  "aria-describedby"?: string;
}

export interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Label, hint and error for one control, wired with aria-describedby / aria-invalid.
 * Errors use text and an icon, never colour alone.
 */
export function Field({ id, label, hint, error, required, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-body-sm font-medium text-navy-950">
        {label}
        {required && (
          <span className="text-danger" aria-hidden="true">
            {" "}
            *
          </span>
        )}
        {!required && <span className="font-normal text-slate-600"> (optional)</span>}
      </label>
      {children({
        id,
        required,
        "aria-invalid": error ? true : undefined,
        "aria-describedby": describedBy,
      })}
      {hint && (
        <p id={hintId} className="text-caption text-slate-600">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1.5 text-caption font-medium text-danger">
          <CircleAlert aria-hidden="true" className="mt-px size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}

/** Shared control styling for Input, Select and Textarea. */
export const controlClasses =
  "w-full rounded-md border border-line-strong bg-white px-4 text-body text-ink transition-colors " +
  "hover:border-navy-700 focus-visible:border-emerald-600 " +
  "disabled:cursor-not-allowed disabled:border-line disabled:bg-surface-muted disabled:text-slate-600 " +
  "aria-[invalid=true]:border-danger";
