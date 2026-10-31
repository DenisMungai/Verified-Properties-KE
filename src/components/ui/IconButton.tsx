import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface IconButtonProps extends Omit<ComponentProps<"button">, "children" | "aria-label"> {
  /** Required: the icon alone gives screen readers nothing to announce. */
  label: string;
  icon: ReactNode;
  variant?: "ghost" | "secondary";
}

/** 44px square target (WCAG 2.5.5 / plan §14). */
export function IconButton({
  label,
  icon,
  variant = "ghost",
  type = "button",
  className,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex size-control shrink-0 items-center justify-center rounded-full text-ink transition-colors",
        "disabled:cursor-not-allowed disabled:text-slate-500",
        variant === "ghost" && "hover:bg-mint-50 active:bg-mint-100",
        variant === "secondary" &&
          "border border-line-strong bg-white hover:border-ink hover:bg-mint-50 active:bg-mint-100",
        className,
      )}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex [&>svg]:size-4">
        {icon}
      </span>
    </button>
  );
}
