"use client";

import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { buttonClasses } from "@/components/ui/Button";
import { openFiltersFallback } from "./FilterDrawer";
import { FILTERS_PANEL_ID, SEARCH_FORM_ID } from "./ids";

/**
 * Phones only (prompt explore-sticky-filters decision 2): once the search card has scrolled out of
 * view, a "Filters (n)" pill floats at the bottom and opens the same filter sheet as the card's
 * button. Not rendered while the card is visible, so it never takes focus or catches taps unseen. Without JavaScript it never appears and the card's button still works.
 */
export function FloatingFiltersButton({ activeCount }: { activeCount: number }) {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const card = document.getElementById(SEARCH_FORM_ID);
    if (!card || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setShown(!entry.isIntersecting));
    observer.observe(card);
    return () => observer.disconnect();
  }, []);

  // Not rendered while the card is visible (a `hidden` attribute would lose to the `flex` class).
  if (!shown) return null;
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex justify-center motion-safe:animate-[fade-in_150ms_ease-out] md:hidden"
    >
      <button
        type="button"
        popoverTarget={FILTERS_PANEL_ID}
        onClick={openFiltersFallback}
        className={buttonClasses({ className: "pointer-events-auto rounded-full px-5" })}
      >
        <SlidersHorizontal aria-hidden="true" className="size-4" />
        Filters{activeCount > 0 ? ` (${activeCount})` : ""}
      </button>
    </div>
  );
}
