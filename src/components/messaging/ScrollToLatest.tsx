"use client";

import { useEffect } from "react";

/** Scrolls the newest message into view on load and whenever a newer one renders. */
export function ScrollToLatest({ latestId }: { latestId: string | null }) {
  useEffect(() => {
    if (!latestId) return;
    document.getElementById("latest")?.scrollIntoView({ block: "end" });
  }, [latestId]);
  return null;
}
