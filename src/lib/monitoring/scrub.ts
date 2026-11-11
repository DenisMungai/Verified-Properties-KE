/**
 * Strips personal data from Sentry events before they leave the server or browser (prompt S21
 * decision 4). Client-safe and dependency-free: it runs in `instrumentation-client` as well.
 *
 * - drops request cookies, headers, body and query string, and the user;
 * - masks email addresses, Kenyan phone numbers and long tokens in messages, exception values,
 *   breadcrumbs and extra/context strings;
 * - drops console breadcrumbs entirely (logs may carry anything).
 *
 * Masking matches the app's log helpers: "j•••@example.com", "+254 7•• ••• 678".
 */

const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
/**
 * +254 / 254 / 07 / 01 followed by 8 digits, allowing spaces or dashes between groups. It must
 * stand alone, so digits inside ids and tokens never match.
 */
const PHONE = /(?<![A-Za-z0-9_-])(?:\+?254|0)[\s-]?([17])\d{2}[\s-]?\d{3}[\s-]?(\d{3})(?![A-Za-z0-9_-])/g;
/** Long opaque strings: tokens, keys, session ids. */
const TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
/** Record ids are useful for debugging and aren't personal data, so UUIDs are kept. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** user:password@ in URLs (database or API connection strings). */
const URL_CREDENTIALS = /(\/\/)[^\s:/@]+:[^\s@/]+@/g;

export function scrubText(text: string): string {
  return text
    .replace(URL_CREDENTIALS, "$1•••:•••@")
    .replace(EMAIL, "$1•••$2")
    .replace(TOKEN, (match) => (UUID.test(match) ? match : "•••"))
    .replace(PHONE, "+254 $1•• ••• $2");
}

/** Recursively scrubs every string in a JSON-like value (depth-limited). */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return scrubText(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = scrubValue(v, depth + 1);
  return out;
}

interface ScrubbableException {
  value?: string;
}

/** The parts of a Sentry event this module touches; everything else passes through. */
export interface ScrubbableEvent {
  message?: string;
  request?: { url?: string; method?: string };
  user?: unknown;
  exception?: { values?: ScrubbableException[] };
  breadcrumbs?: ScrubbableBreadcrumb[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  tags?: Record<string, unknown>;
}

export interface ScrubbableBreadcrumb {
  category?: string;
  message?: string;
  data?: Record<string, unknown>;
}

/** Keeps only the request URL (without its query string) and method. */
function scrubRequest(request: ScrubbableEvent["request"]): ScrubbableEvent["request"] {
  if (!request) return undefined;
  const url = typeof request.url === "string" ? scrubText(request.url.split("?")[0]) : undefined;
  return { url, method: request.method };
}

export function scrubBreadcrumb<T extends ScrubbableBreadcrumb>(crumb: T): T | null {
  if (crumb.category === "console") return null;
  return {
    ...crumb,
    message: crumb.message === undefined ? undefined : scrubText(crumb.message),
    data: crumb.data === undefined ? undefined : (scrubValue(crumb.data) as Record<string, unknown>),
  };
}

export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const out: ScrubbableEvent = { ...event };
  delete out.user;
  out.request = scrubRequest(event.request);
  if (out.message !== undefined) out.message = scrubText(out.message);
  if (event.exception?.values) {
    out.exception = {
      ...event.exception,
      values: event.exception.values.map((ex) => ({ ...ex, value: ex.value === undefined ? undefined : scrubText(ex.value) })),
    };
  }
  if (event.breadcrumbs) {
    out.breadcrumbs = event.breadcrumbs.map((b) => scrubBreadcrumb(b)).filter((b): b is ScrubbableBreadcrumb => b !== null);
  }
  if (event.extra) out.extra = scrubValue(event.extra) as Record<string, unknown>;
  if (event.contexts) out.contexts = scrubValue(event.contexts) as Record<string, unknown>;
  if (event.tags) out.tags = scrubValue(event.tags) as Record<string, unknown>;
  return out as T;
}
