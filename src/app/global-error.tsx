"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";
import "./globals.css";

/**
 * Last-resort error page when the root layout itself fails (prompt S21). Reports the error to
 * Sentry (scrubbed, and only when a DSN is set) and offers a reload. It renders its own <html>,
 * so it can't use the site header or footer.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-dvh items-center justify-center p-4">
        <main className="flex max-w-md flex-col items-start gap-3 rounded-lg border border-line bg-white p-6">
          <h1 className="text-title">Something went wrong</h1>
          <p className="text-body text-slate-700">The page couldn&apos;t load. Please try again in a moment.</p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex h-control items-center rounded-lg bg-emerald-600 px-5 text-small font-semibold text-white hover:bg-emerald-700"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
