import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "verified";

/** Design: Status badges (soft tinted pills, no border). */
const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-slate-700",
  success: "bg-mint-50 text-success",
  // The warning token is ~3.6:1 on white; badge text uses the darker warning-text shade.
  warning: "bg-warning-tint text-warning-text",
  danger: "bg-danger-tint text-danger",
  info: "bg-[#EAF1FD] text-info",
  verified: "bg-mint-50 text-emerald-700",
};

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Status pill. Meaning is always carried by text, never by colour alone. */
export function Badge({ tone = "neutral", icon, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-micro font-semibold",
        tones[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex [&>svg]:size-3">
          {icon}
        </span>
      )}
      {children}
    </span>
  );
}

/**
 * The only way to render the verified tick. The wording is fixed by plan v2.0 §5: it states
 * what was checked and never implies a licence or a guarantee about a property.
 * Callers must only render it when the server-derived verified status is true.
 */
export function VerifiedBadge({ className }: { className?: string }) {
  return (
    <Badge tone="verified" icon={<BadgeCheck />} className={className}>
      Profile verified
    </Badge>
  );
}
