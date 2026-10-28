import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info" | "verified";

const tones: Record<BadgeTone, string> = {
  neutral: "border-line bg-surface-muted text-slate-700",
  success: "border-mint-100 bg-mint-50 text-success",
  // The warning token (#A96508) is only ~4.3:1 on this tint; 12px badge text needs 4.5:1.
  warning: "border-[#F2DDB8] bg-[#FDF6EA] text-[#8A5206]",
  danger: "border-[#F5CFCB] bg-[#FDF1F0] text-danger",
  info: "border-[#C9DAF8] bg-[#F0F5FE] text-info",
  verified: "border-mint-100 bg-mint-100 text-emerald-700",
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
        "inline-flex items-center gap-1 rounded-pill border px-2.5 py-0.5 text-caption font-medium",
        tones[tone],
        className,
      )}
    >
      {icon && (
        <span aria-hidden="true" className="inline-flex [&>svg]:size-3.5">
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
