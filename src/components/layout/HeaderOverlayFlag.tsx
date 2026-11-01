"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Scrolled less than this (px) counts as "at the top", where the header sits clear over the hero. */
const CLEAR_SCROLL_LIMIT = 16;

/** Pages whose photo runs up behind the header: the home hero and the AuthShell pages. */
export const CLEAR_HEADER_PATHS: ReadonlySet<string> = new Set([
  "/",
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/reset-password",
  "/check-email",
]);

/**
 * Renders a hidden marker inside the header while it should be clear: on a photo page, at the
 * top. SiteHeader styles itself with `has-[[data-header-overlay]]` variants, so the header stays a
 * server component and those pages prerender clear (no white flash). Elsewhere it renders nothing: solid.
 */
export function HeaderOverlayFlag() {
  const pathname = usePathname();
  const [atTop, setAtTop] = useState(true);

  useEffect(() => {
    function update() {
      setAtTop(window.scrollY < CLEAR_SCROLL_LIMIT);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  if (!CLEAR_HEADER_PATHS.has(pathname) || !atTop) return null;
  return <span data-header-overlay hidden />;
}
