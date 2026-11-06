import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Design "01 — Lister Dashboard" stat card (prompt S13 decision 13): label, figure, one line.
 * The line's colour never carries meaning alone; its words do.
 */
export function StatCard({
  id,
  label,
  value,
  line,
  lineTone = "muted",
  link,
  valueSize = "display",
}: {
  id: string;
  label: string;
  value: ReactNode;
  line?: ReactNode;
  lineTone?: "positive" | "muted";
  link?: { href: string; label: string };
  valueSize?: "display" | "title";
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2 rounded-lg border border-line bg-white p-5">
      <h2 id={id} className="text-small font-medium text-slate-700">
        {label}
      </h2>
      <p className={cn(valueSize === "display" ? "text-display-sm tabular" : "text-title", "text-ink")}>{value}</p>
      {line && <p className={cn("text-small", lineTone === "positive" ? "text-emerald-700" : "text-slate-600")}>{line}</p>}
      {link && (
        <Link
          href={link.href}
          className="-mb-3 mt-auto inline-flex min-h-control items-center self-start text-small font-medium text-emerald-700 underline underline-offset-4 hover:text-ink"
        >
          {link.label}
        </Link>
      )}
    </section>
  );
}
