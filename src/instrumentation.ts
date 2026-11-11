import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

/**
 * Server and edge error reporting (prompt S21 decision 4). `register` runs once per server
 * instance; `onRequestError` reports errors from Server Components, Route Handlers, Server
 * Actions and the proxy. Both are no-ops without `NEXT_PUBLIC_SENTRY_DSN`.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" || process.env.NEXT_RUNTIME === "edge") {
    Sentry.init(sentryOptions());
  }
}

export const onRequestError = Sentry.captureRequestError;
