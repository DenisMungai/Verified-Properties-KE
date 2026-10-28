import type { ReactNode } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

const chipClasses =
  "inline-flex min-h-9 items-center gap-1 rounded-pill border border-line-strong bg-white pl-3 text-body-sm text-ink";

const removeClasses =
  "-my-1 inline-flex size-9 items-center justify-center rounded-pill text-slate-600 hover:bg-mint-50 hover:text-navy-950";

interface ChipBaseProps {
  children: ReactNode;
  className?: string;
}

interface RemovableByLink extends ChipBaseProps {
  /** URL with this filter removed: works without JavaScript. */
  removeHref: string;
  removeLabel: string;
  onRemove?: never;
}

interface RemovableByButton extends ChipBaseProps {
  /** Client-side removal; the parent must be a client component. */
  onRemove: () => void;
  removeLabel: string;
  removeHref?: never;
}

interface StaticChip extends ChipBaseProps {
  removeHref?: never;
  onRemove?: never;
  removeLabel?: never;
}

export type ChipProps = RemovableByLink | RemovableByButton | StaticChip;

/** Active-filter chip. The remove control is labelled for screen readers ("Remove Nairobi"). */
export function Chip({ children, className, ...props }: ChipProps) {
  const icon = <X aria-hidden="true" className="size-4" />;
  return (
    <span className={cn(chipClasses, !props.removeLabel && "pr-3", className)}>
      {children}
      {props.removeHref !== undefined && (
        <Link href={props.removeHref} aria-label={props.removeLabel} className={removeClasses}>
          {icon}
        </Link>
      )}
      {props.onRemove !== undefined && (
        <button
          type="button"
          onClick={props.onRemove}
          aria-label={props.removeLabel}
          className={removeClasses}
        >
          {icon}
        </button>
      )}
    </span>
  );
}
