"use client";

import { useRef, type ReactNode } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

const arrowClasses =
  "inline-flex size-control items-center justify-center border transition-colors duration-200 " +
  "disabled:cursor-not-allowed disabled:opacity-40";

/**
 * A horizontal snap rail of `w-72 sm:w-80` cards with square previous / next buttons. The buttons only
 * scroll the list; without JavaScript the rail still scrolls by touch or trackpad.
 */
export function CardRail({
  headingId,
  heading,
  children,
}: {
  headingId: string;
  heading: ReactNode;
  /** `<li>` items; each is sized to `w-72 sm:w-80` by the rail. */
  children: ReactNode;
}) {
  const listRef = useRef<HTMLUListElement>(null);

  function scrollByCard(direction: 1 | -1) {
    const list = listRef.current;
    const card = list?.firstElementChild as HTMLElement | null;
    if (!list || !card) return;
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    list.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: "smooth" });
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-4">
        <h2 id={headingId} className="text-title">
          {heading}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => scrollByCard(-1)}
            aria-label="Previous listings"
            className={cn(arrowClasses, "border-line-strong bg-white text-ink hover:border-ink")}
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByCard(1)}
            aria-label="Next listings"
            className={cn(arrowClasses, "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700")}
          >
            <ArrowRight aria-hidden="true" className="size-4" />
          </button>
        </div>
      </div>
      <ul
        ref={listRef}
        className="hide-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:gap-4 sm:px-0 [&>li]:flex [&>li]:w-72 sm:[&>li]:w-80 [&>li]:shrink-0 [&>li]:snap-start"
      >
        {children}
      </ul>
    </section>
  );
}
