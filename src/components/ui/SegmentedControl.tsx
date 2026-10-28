import { cn } from "@/lib/cn";

export interface SegmentOption<V extends string = string> {
  value: V;
  label: string;
}

interface SegmentedControlBase<V extends string> {
  /** Accessible group name, rendered as a visually hidden legend. */
  legend: string;
  name: string;
  options: readonly SegmentOption<V>[];
  size?: "md" | "lg";
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
  const { legend, name, options, size = "md", className } = props;
  return (
    <fieldset className={cn("min-w-0", className)}>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex max-w-full rounded-md border border-line bg-surface-muted p-1">
        {options.map((option) => {
          const id = `${name}-${option.value}`;
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
                  "flex cursor-pointer items-center justify-center whitespace-nowrap rounded-sm px-4 text-button text-slate-700 transition-colors",
                  "hover:text-navy-950 peer-checked:bg-white peer-checked:text-navy-950 peer-checked:shadow-card",
                  "peer-focus-visible:shadow-focus peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-emerald-600",
                  "peer-disabled:cursor-not-allowed peer-disabled:text-slate-500",
                  size === "md" ? "h-9" : "h-10",
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
