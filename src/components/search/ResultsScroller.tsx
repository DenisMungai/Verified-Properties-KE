"use client";

import { useEffect, useRef, type ReactNode } from "react";

const STORAGE_PREFIX = "explore-scroll:";
/** How long a saved position keeps waiting for streamed results before giving up. */
const RESTORE_WINDOW_MS = 4000;

function readSaved(key: string): number {
  try {
    return Number(sessionStorage.getItem(STORAGE_PREFIX + key)) || 0;
  } catch {
    return 0;
  }
}

function writeSaved(key: string, top: number) {
  try {
    if (top > 0) sessionStorage.setItem(STORAGE_PREFIX + key, String(Math.round(top)));
    else sessionStorage.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Storage blocked (private mode): the list simply starts at the top.
  }
}

/**
 * The Explore results list. From md it is the page's only scroll area (see globals.css); below md
 * it adds no scrolling and the page scrolls as before. The browser only restores the window's
 * scroll on Back, so this remembers the list's own position per search URL for the tab. Mount it
 * with `key={href}` so a new search, sort or page starts at the top.
 */
export function ResultsScroller({ storageKey, children }: { storageKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || getComputedStyle(el).overflowY !== "auto") return;

    const target = readSaved(storageKey);
    let restoring = target > 0;
    const stopRestoring = () => {
      restoring = false;
    };
    const tryRestore = () => {
      if (!restoring) return;
      el.scrollTop = target;
      if (Math.abs(el.scrollTop - target) < 2) restoring = false;
    };

    let frame = 0;
    const onScroll = () => {
      if (restoring) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => writeSaved(storageKey, el.scrollTop));
    };

    // Results stream in after mount, so retry as the content grows until the position is reached.
    const observer = new ResizeObserver(tryRestore);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    tryRestore();
    const timeout = window.setTimeout(stopRestoring, RESTORE_WINDOW_MS);

    el.addEventListener("scroll", onScroll, { passive: true });
    for (const type of ["wheel", "touchstart", "keydown", "pointerdown"] as const) {
      el.addEventListener(type, stopRestoring, { passive: true });
    }
    return () => {
      observer.disconnect();
      window.clearTimeout(timeout);
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      for (const type of ["wheel", "touchstart", "keydown", "pointerdown"] as const) {
        el.removeEventListener(type, stopRestoring);
      }
    };
  }, [storageKey]);

  return (
    <div
      ref={ref}
      data-results-scroll
      // -mx-1 / px-1 keep card focus rings clear of the clipping edge; the stable gutter stops the
      // grid shifting when a short result set has no scrollbar.
      className="md:-mx-1 md:min-h-0 md:flex-1 md:overflow-y-auto md:overscroll-contain md:px-1 md:pb-4 md:pt-1 md:[scrollbar-gutter:stable]"
    >
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  );
}
