import { withSentryConfig } from "@sentry/nextjs/config";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * S22: the e2e suite runs its own `next dev` (port 3100) next to yours. The dev lockfile lives
   * in distDir, so it builds into a separate folder. Unset (you, CI, Vercel) means `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  /*
   * Dev only. `next dev` serves its scripts and HMR to `localhost` alone; opened from
   * 127.0.0.1 or the printed Network address, the page never hydrates and no button works.
   * Hostnames only (no scheme or port); `*` stands for one label, so the LAN IP can change.
   */
  allowedDevOrigins: ["127.0.0.1", "10.*.*.*", "192.168.*.*"],
  // S15: inquiries moved into Messages; old bookmarks and emails still land somewhere useful.
  async redirects() {
    return [{ source: "/account/inquiries", destination: "/account/messages", permanent: false }];
  },
};

/**
 * Sentry (prompt S21 decision 4). Source maps are uploaded only once SENTRY_AUTH_TOKEN (build
 * time, server only) is set; until then nothing is uploaded and the build needs no Sentry account.
 */
export default withSentryConfig(nextConfig, {
  silent: true,
  telemetry: false,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});
