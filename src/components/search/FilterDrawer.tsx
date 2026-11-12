"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { FILTERS_PANEL_ID, SEARCH_FORM_ID } from "./ids";

const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * Browsers without the Popover API (iOS Safari 16 and older, older Android browsers) ignore
 * `popover` / `popoverTarget`; there the drawer opens and closes through a `data-open` attribute.
 */
function supportsPopover(): boolean {
  return typeof HTMLElement !== "undefined" && "showPopover" in HTMLElement.prototype;
}

function filtersPanel(): HTMLElement | null {
  return document.getElementById(FILTERS_PANEL_ID);
}

/** Opens the filter drawer without the Popover API (data-open fallback); popover openers use popoverTarget. */
export function openFiltersFallback(): void {
  if (!supportsPopover()) filtersPanel()?.setAttribute("data-open", "");
}

function hidePanel(panel: HTMLElement | null) {
  if (!panel) return;
  if (supportsPopover() && panel.matches(":popover-open")) panel.hidePopover();
  panel.removeAttribute("data-open");
}

/** Opens the filter drawer below `md`; rendered in the search card next to Buy / Rent / Land. */
export function FiltersButton({ activeCount, className }: { activeCount: number; className?: string }) {
  return (
    <button
      type="button"
      popoverTarget={FILTERS_PANEL_ID}
      onClick={() => {
        if (!supportsPopover()) filtersPanel()?.toggleAttribute("data-open");
      }}
      className={buttonClasses({ variant: "secondary", className: cn("px-4", className) })}
    >
      <SlidersHorizontal aria-hidden="true" className="size-4" />
      Filters{activeCount > 0 ? ` (${activeCount})` : ""}
    </button>
  );
}

/**
 * The filter sidebar from `md`, and below it a full-screen drawer opened by `FiltersButton`
 * (prompt S7 decision 6). The drawer is an HTML popover, so it opens, closes and closes on Escape
 * without JavaScript; scripts close it after Apply or Reset and when the window grows to `md`, and
 * drive the data-open fallback where the Popover API is missing.
 */
export function FilterDrawer({
  clearHref,
  children,
}: {
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
    // The native popover closes on Escape by itself; the data-open fallback needs this.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") panelRef.current?.removeAttribute("data-open");
    };
    desktop.addEventListener("change", onChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      desktop.removeEventListener("change", onChange);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    // Below md the wrapper adds no box (display: contents), so the closed drawer leaves no empty grid row.
    // From md the wrapper is the sticky grid item (prompt explore-sticky-filters decision 1): sticky
    // on the aside did nothing, because its parent was exactly as tall as it. Capped at the viewport
    // so a long filter list scrolls inside; -m-1/p-1 keep focus outlines clear of the scroll box.
    <div className="max-md:contents md:sticky md:top-[82px] md:-m-1 md:max-h-[calc(100dvh-98px)] md:self-start md:overflow-y-auto md:overscroll-contain md:p-1">
      <aside
        ref={panelRef}
        id={FILTERS_PANEL_ID}
        popover="auto"
        aria-labelledby="filters-heading"
        className={cn(
          // Below md: a full-screen sheet, hidden until opened as a popover or via data-open (no
          // Popover API). A browser that doesn't know :popover-open drops that rule and stays hidden.
          "fixed inset-0 m-0 h-dvh max-md:z-50 max-h-none w-full max-w-none flex-col overflow-hidden border-0 bg-white p-0 text-ink",
          "backdrop:bg-ink/40 max-md:hidden max-md:data-[open]:flex max-md:[&:popover-open]:flex",
          // md and up: a compact sidebar card, always shown (the wrapper above is what sticks).
          "md:static md:flex md:h-auto md:w-auto md:overflow-visible md:rounded-lg md:border md:border-line md:p-4",
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
            onClick={hide}
            className="inline-flex size-control items-center justify-center rounded-md text-ink hover:bg-mint-50 md:hidden"
          >
            <X aria-hidden="true" className="size-5" />
            <span className="sr-only">Close filters</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:overflow-visible md:p-0 md:pt-4">{children}</div>
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
