/** HTTP helpers for the provider test: timeouts, pacing, budget cap and key redaction. */
import { REQUEST_TIMEOUT_MS } from "./config";

export class ProviderError extends Error {
  constructor(
    message: string,
    /** True when retrying cannot help (bad key, API not enabled). */
    readonly fatal = false,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class BudgetExceededError extends Error {
  constructor(provider: string, cap: number) {
    super(`${provider}: billable request cap of ${cap} reached, stopping before going over it`);
    this.name = "BudgetExceededError";
  }
}

/** Counts billable requests for one provider and refuses to go past the cap (decision 10). */
export class Budget {
  billed = 0;
  constructor(
    readonly provider: string,
    readonly cap: number,
  ) {}

  take(): void {
    if (this.billed + 1 > this.cap) throw new BudgetExceededError(this.provider, this.cap);
    this.billed += 1;
  }
}

/** Keeps at least `minIntervalMs` between request starts. */
export class Pacer {
  private last = 0;
  constructor(private readonly minIntervalMs: number) {}

  async wait(): Promise<void> {
    const delay = this.last + this.minIntervalMs - Date.now();
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    this.last = Date.now();
  }
}

const SECRET_PARAMS = ["key", "access_token", "token", "signature"];

/** A URL safe to log: secret query parameters replaced with ***. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const name of SECRET_PARAMS) if (parsed.searchParams.has(name)) parsed.searchParams.set(name, "***");
    return parsed.toString().replace(/%2A%2A%2A/g, "***");
  } catch {
    return "<unparseable url>";
  }
}

/** Removes any occurrence of the given secrets from a message before it is printed. */
export function scrub(message: string, secrets: readonly (string | undefined)[]): string {
  let out = message;
  for (const secret of secrets) if (secret && secret.length >= 8) out = out.split(secret).join("***");
  return out;
}

export async function fetchWithTimeout(url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError" ? "timed out" : "network error";
    throw new ProviderError(`${reason}: ${redactUrl(url)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the body as JSON, turning HTTP errors into ProviderError without echoing secrets. */
export async function readJson(response: Response, label: string): Promise<unknown> {
  if (!response.ok) {
    const fatal = response.status === 401 || response.status === 403;
    let detail = "";
    try {
      const body = (await response.json()) as { error?: { message?: string; status?: string }; message?: string };
      detail = body.error?.status ?? body.error?.message ?? body.message ?? "";
    } catch {
      // Non-JSON error body: the status code is enough.
    }
    throw new ProviderError(`${label}: HTTP ${response.status}${detail ? ` (${detail.slice(0, 120)})` : ""}`, fatal);
  }
  return response.json();
}
