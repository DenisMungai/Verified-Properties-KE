import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * What joining or creating an agency changes (prompt S23 decision 6), from `joinWarning` on the
 * server with real numbers. Text and icon, not colour alone.
 */
export function JoinWarning({ lines, heading, className }: { lines: string[]; heading: string; className?: string }) {
  return (
    <div className={cn("flex gap-3 rounded-lg bg-warning-tint px-4 py-3 text-small text-warning-text", className)}>
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{heading}</p>
        {lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </div>
    </div>
  );
}
