/**
 * Log helpers (AGENTS.md §8: logs carry no secrets or personal data). Errors are logged by class
 * name only: messages can carry addresses, phone numbers or raw provider text.
 */

/** An error's name only, never its message. */
export function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/** `logFailure("save", error)` → `[tag] save failed ErrorName`. One per module, by log tag. */
export function failureLogger(tag: string): (action: string, error: unknown) => void {
  return (action, error) => console.error(`[${tag}] ${action} failed`, errorName(error));
}
