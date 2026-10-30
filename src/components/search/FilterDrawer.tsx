"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { FILTERS_PANEL_ID, SEARCH_FORM_ID } from "./ids";

const DESKTOP_QUERY = "(min-width: 1024px)";

function hidePanel(panel: HTMLElement | null) {
  if (panel?.matches(":popover-open")) panel.hidePopover();
}

/**
 * The filter sidebar on `lg`, and below it a full-screen drawer behind "Filters (n)" (prompt S7
 * decision 6). The drawer is an HTML popover, so it opens, closes and closes on Escape without
 * JavaScript; scripts only close it after Apply or Reset and when the window grows to `lg`.
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
    <div className="lg:self-start">
      <button
        type="button"
        popoverTarget={FILTERS_PANEL_ID}
        className={buttonClasses({ variant: "secondary", className: "w-full lg:hidden" })}
      >
        <SlidersHorizontal aria-hidden="true" className="size-5" />
        Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
      <aside
        ref={panelRef}
        id={FILTERS_PANEL_ID}
        popover="auto"
        aria-labelledby="filters-heading"
        className={cn(
          // Below lg: a full-screen popover sheet (hidden by the browser until opened).
          "fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-white p-0 text-ink",
          "backdrop:bg-ink/40 [&:popover-open]:flex",
          // lg and up: a static sidebar card, always shown.
          "lg:static lg:flex lg:h-auto lg:w-auto lg:overflow-visible lg:rounded-xl lg:border lg:border-line lg:p-6 lg:shadow-card",
        )}
      >
        <div className="flex h-header shrink-0 items-center justify-between border-b border-line px-4 lg:h-auto lg:px-0 lg:pb-4">
          <h2 id="filters-heading" className="text-h4">
            Filters
          </h2>
          <Link
            href={clearHref}
            className="hidden min-h-control items-center rounded-md px-2 text-body-sm font-semibold text-emerald-700 hover:bg-mint-50 lg:inline-flex"
          >
            Clear all
          </Link>
          <button
            type="button"
            popoverTarget={FILTERS_PANEL_ID}
            popoverTargetAction="hide"
            className="inline-flex size-control items-center justify-center rounded-md text-ink hover:bg-mint-50 lg:hidden"
          >
            <X aria-hidden="true" className="size-6" />
            <span className="sr-only">Close filters</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:overflow-visible lg:p-0 lg:pt-6">{children}</div>
        <div className="flex shrink-0 gap-3 border-t border-line p-4 lg:border-0 lg:p-0 lg:pt-8">
          <Link href={clearHref} onClick={hide} className={buttonClasses({ variant: "secondary", className: "flex-1 lg:hidden" })}>
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
