import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/monitoring/sentry-options";

/** Browser error reporting (prompt S21 decision 4). A no-op without `NEXT_PUBLIC_SENTRY_DSN`. */
Sentry.init(sentryOptions());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
