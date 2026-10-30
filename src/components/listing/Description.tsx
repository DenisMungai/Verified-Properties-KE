"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

/** Above this length the text is clamped once scripts run (prompt S8 decision 9). */
const CLAMP_CHARS = 600;

const noop = () => () => {};

/** False in the server render and during hydration, true afterwards. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * The listing description as plain-text paragraphs. Long text is clamped with Show more / Show
 * less, but only after hydration: without JavaScript the full text shows.
 */
export function Description({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const hydrated = useHydrated();
  const id = useId();
  const paragraphs = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const long = text.length > CLAMP_CHARS;
  const clamped = hydrated && long && !expanded;

  return (
    <div className="flex flex-col items-start gap-2">
      <div
        id={id}
        className={cn(
          "flex flex-col gap-3 text-body text-slate-700",
          clamped && "max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]",
        )}
      >
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="whitespace-pre-line break-words">
            {paragraph}
          </p>
        ))}
      </div>
      {hydrated && long && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((open) => !open)}
          className="inline-flex min-h-control items-center rounded-md px-2 text-button text-emerald-700 hover:bg-mint-50"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
