import { cn } from "@/lib/cn";

export interface SegmentOption<V extends string = string> {
  value: V;
  label: string;
}

interface SegmentedControlBase<V extends string> {
  /** Accessible group name. Visually hidden unless `legendClassName` styles it. */
  legend: string;
  legendClassName?: string;
  name: string;
  /**
   * Prefix for the radio ids (default: `name`). Give each control on a page, and on routes Next
   * keeps mounted in the background, its own prefix so labels never target another control.
   */
  idPrefix?: string;
  options: readonly SegmentOption<V>[];
  size?: "md" | "lg";
  /** `pill`: filled Forest pill in a grey track (homepage). `outline`: bordered boxes (create listing). */
  variant?: "pill" | "outline";
  className?: string;
}

interface Uncontrolled<V extends string> extends SegmentedControlBase<V> {
  defaultValue?: V;
  value?: never;
  onValueChange?: never;
}

interface Controlled<V extends string> extends SegmentedControlBase<V> {
  value: V;
  /** Client-side only; the parent must be a client component. */
  onValueChange: (value: V) => void;
  defaultValue?: never;
}

export type SegmentedControlProps<V extends string> = Uncontrolled<V> | Controlled<V>;

/**
 * Built on native radio inputs, so it submits with forms, works without JavaScript and gets
 * arrow-key navigation from the browser (radio group semantics).
 */
export function SegmentedControl<V extends string>(props: SegmentedControlProps<V>) {
  const { legend, legendClassName = "sr-only", name, idPrefix = name, options, size = "md", variant = "pill", className } = props;
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className={legendClassName}>{legend}</legend>
      <div className={cn("inline-flex max-w-full", variant === "pill" ? "gap-1 rounded-full bg-surface-muted p-1" : "flex-wrap gap-3")}>
        {options.map((option) => {
          const id = `${idPrefix}-${option.value}`;
          const checkedProps =
            props.onValueChange !== undefined
              ? {
                  checked: props.value === option.value,
                  onChange: () => props.onValueChange(option.value),
                }
              : { defaultChecked: props.defaultValue === option.value };
          return (
            <div key={option.value} className="relative">
              <input
                type="radio"
                id={id}
                name={name}
                value={option.value}
                className="peer sr-only"
                {...checkedProps}
              />
              <label
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer items-center whitespace-nowrap text-small font-semibold transition-colors",
                  variant === "pill"
                    ? // Design (homepage "Buy / Rent / Land"): selected option is a filled Forest pill.
                      "justify-center rounded-full px-4 text-slate-700 hover:bg-white hover:text-ink peer-checked:bg-emerald-600 peer-checked:text-white"
                    : // Design "04 — Create Listing": bordered boxes; selected has a Forest border on Soft green.
                      "min-w-32 rounded border border-line-strong bg-white px-4 text-ink hover:border-ink peer-checked:border-emerald-600 peer-checked:bg-mint-50 peer-checked:text-emerald-700",
                  "peer-focus-visible:shadow-focus peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-600",
                  "peer-disabled:cursor-not-allowed peer-disabled:text-slate-500",
                  size === "md" ? "h-control" : "h-control-lg",
                )}
              >
                {option.label}
              </label>
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
