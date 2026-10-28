import { cn } from "@/lib/cn";

/** Decorative placeholder; pair it with an accessible loading message on the region. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded-md bg-surface-muted", className)} />;
}
