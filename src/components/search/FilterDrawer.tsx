"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { FILTERS_PANEL_ID, SEARCH_FORM_ID } from "./ids";

const DESKTOP_QUERY = "(min-width: 768px)";

function hidePanel(panel: HTMLElement | null) {
  if (panel?.matches(":popover-open")) panel.hidePopover();
}

/**
 * The filter sidebar from `md`, and below it a full-screen drawer behind "Filters (n)" (prompt S7
 * decision 6). The drawer is an HTML popover, so it opens, closes and closes on Escape without
 * JavaScript; scripts only close it after Apply or Reset and when the window grows to `md`.
 */
export function FilterDrawer({
  activeCount,
  clearHref,
  children,
}: {
  activeCount: number;
  clearHref: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  const hide = () => hidePanel(panelRef.current);

  useEffect(() => {
    const desktop = window.matchMedia(DESKTOP_QUERY);
    const onChange = () => {
      if (desktop.matches) hidePanel(panelRef.current);
    };
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="md:self-start">
      <button
        type="button"
        popoverTarget={FILTERS_PANEL_ID}
        className={buttonClasses({ variant: "secondary", className: "w-full md:hidden" })}
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
      <aside
        ref={panelRef}
        id={FILTERS_PANEL_ID}
        popover="auto"
        aria-labelledby="filters-heading"
        className={cn(
          // Below md: a full-screen popover sheet (hidden by the browser until opened).
          "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-white p-0 text-ink",
          "backdrop:bg-ink/40 [&:popover-open]:flex",
          // md and up: a compact sticky sidebar card, always shown.
          "md:sticky md:top-[82px] md:flex md:h-auto md:w-auto md:overflow-visible md:rounded-lg md:border md:border-line md:p-4",
        )}
      >
        <div className="flex h-[66px] shrink-0 items-center justify-between border-b border-line px-4 md:h-auto md:px-0 md:pb-3">
          <h2 id="filters-heading" className="text-title">
            Filters
          </h2>
          <Link
            href={clearHref}
            className="hidden min-h-control items-center rounded-md px-2 text-small font-semibold text-emerald-700 hover:bg-mint-50 md:inline-flex"
          >
            Clear all
          </Link>
          <button
            type="button"
            popoverTarget={FILTERS_PANEL_ID}
            popoverTargetAction="hide"
            className="inline-flex size-control items-center justify-center rounded-md text-ink hover:bg-mint-50 md:hidden"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Close filters</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 md:overflow-visible md:p-0 md:pt-4">{children}</div>
        <div className="flex shrink-0 gap-3 border-t border-line p-4 md:border-0 md:p-0 md:pt-5">
          <Link href={clearHref} onClick={hide} className={buttonClasses({ variant: "secondary", className: "flex-1 md:hidden" })}>
            Reset
          </Link>
          <button type="submit" form={SEARCH_FORM_ID} onClick={hide} className={buttonClasses({ className: "flex-1" })}>
            Apply filters
          </button>
        </div>
      </aside>
    </div>
  );
}
