import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  /*
   * Dev only. `next dev` serves its scripts and HMR to `localhost` alone; opened from
   * 127.0.0.1 or the printed Network address, the page never hydrates and no button works.
   * Hostnames only (no scheme or port); `*` stands for one label, so the LAN IP can change.
   */
  allowedDevOrigins: ["127.0.0.1", "10.*.*.*", "192.168.*.*"],
};

export default nextConfig;
