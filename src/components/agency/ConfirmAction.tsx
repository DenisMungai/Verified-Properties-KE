import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { ConfirmSubmitButton } from "@/components/billing/ConfirmSubmitButton";
import type { ButtonVariant } from "@/components/ui";
import { cn } from "@/lib/cn";

/**
 * A two-step action in a disclosure, not a popover (the owner's phone has no Popover API): the
 * first click explains, the second confirms. Same pattern as InvoiceRowActions.
 */
export function ConfirmAction({
  label,
  srLabel,
  consequence,
  confirm,
  variant = "danger",
  action,
  fields,
  tone = "text-ink",
  className,
}: {
  label: string;
  /** Extra screen-reader text naming the target, e.g. " Wanjiru Kamau". */
  srLabel?: string;
  consequence: ReactNode;
  confirm: string;
  variant?: ButtonVariant;
  action: (formData: FormData) => Promise<void>;
  fields?: Record<string, string>;
  tone?: string;
  className?: string;
}) {
  return (
    <details className={cn("group -mx-3", className)}>
      <summary
        className={cn(
          "inline-flex min-h-control cursor-pointer list-none items-center gap-1 rounded-lg px-3 text-small font-medium",
          "hover:bg-canvas md:min-h-control-sm [&::-webkit-details-marker]:hidden",
          tone,
        )}
      >
        {label}
        {srLabel && <span className="sr-only">{srLabel}</span>}
        <ChevronDown aria-hidden="true" className="size-4 text-slate-600 transition-transform group-open:rotate-180" />
      </summary>
      <form action={action} className="flex flex-col gap-2 px-3 pb-1 pt-2 md:max-w-72">
        {Object.entries(fields ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="text-micro text-slate-700">{consequence}</div>
        <ConfirmSubmitButton label={confirm} variant={variant} />
      </form>
    </details>
  );
}
