import type { ZodError } from "zod";

/** Typed result every form Server Action returns (never stack traces or internals). */
export interface ActionState {
  ok?: boolean;
  /** Success or neutral message shown above the form. */
  message?: string;
  /** Error that is not about one field. */
  formError?: string;
  fieldErrors?: Record<string, string>;
  /** Submitted non-secret values, so the form keeps them after an error. */
  values?: Record<string, string>;
}

export const INITIAL_ACTION_STATE: ActionState = {};

/** First message per field. */
export function fieldErrorsFrom(error: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "form";
    out[key] ??= issue.message;
  }
  return out;
}

/** Non-secret string fields from a form, for re-filling it after an error. */
export function keepValues(formData: FormData, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of names) {
    const value = formData.get(name);
    if (typeof value === "string") out[name] = value;
  }
  return out;
}
