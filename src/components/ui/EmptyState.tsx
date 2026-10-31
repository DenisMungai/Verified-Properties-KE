import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-dashed border-line-strong bg-white px-5 py-10 text-center",
        className,
      )}
    >
      {icon && (
        <span
          aria-hidden="true"
          className="inline-flex size-10 items-center justify-center rounded-full bg-mint-50 text-emerald-600 [&>svg]:size-5 [&>svg]:[stroke-width:1.5]"
        >
          {icon}
        </span>
      )}
      <h2 className="text-title">{title}</h2>
      {description && <p className="max-w-prose text-small text-slate-600">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
