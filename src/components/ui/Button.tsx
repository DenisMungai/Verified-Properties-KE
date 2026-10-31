import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "ghost" | "danger";
export type ButtonSize = "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg px-5 text-small font-semibold transition-colors duration-200 " +
  "disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

/** Design: Button - Primary / Secondary / Quiet. */
const variants: Record<ButtonVariant, string> = {
  primary:
    "bg-emerald-600 text-white hover:bg-emerald-700 active:bg-emerald-700 " +
    "disabled:bg-surface-muted disabled:text-slate-600",
  secondary:
    "border border-line-strong bg-white text-ink hover:border-ink hover:bg-canvas active:bg-mint-50 " +
    "disabled:border-line disabled:bg-surface-muted disabled:text-slate-600",
  quiet:
    "bg-mint-50 text-emerald-700 hover:bg-mint-100 active:bg-mint-100 " +
    "disabled:bg-surface-muted disabled:text-slate-600",
  ghost:
    "text-emerald-700 hover:bg-mint-50 active:bg-mint-100 disabled:text-slate-600 disabled:hover:bg-transparent",
  danger:
    "bg-danger text-white hover:bg-[#912018] active:bg-[#7a1b14] " +
    "disabled:bg-surface-muted disabled:text-slate-600",
};

const sizes: Record<ButtonSize, string> = {
  md: "h-control min-w-control",
  lg: "h-control-lg min-w-control px-6",
};

/** Classes for links styled as buttons (e.g. `<Link className={buttonClasses()}>`). */
export function buttonClasses({
  variant = "primary",
  size = "md",
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks further clicks. */
  loading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  type = "button",
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, className })}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  );
}
