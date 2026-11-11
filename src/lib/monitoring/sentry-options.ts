import type { BrowserOptions } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

/**
 * Sentry options shared by the server, edge and browser inits (prompt S21 decision 4). Sentry is
 * enabled only when `NEXT_PUBLIC_SENTRY_DSN` is set, so local dev and tests send nothing. No
 * tracing, no replay, no default PII; every event and breadcrumb goes through the scrubber.
 * A DSN is designed to be public: it can only send events.
 */
export function sentryOptions(): BrowserOptions {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
  };
}
