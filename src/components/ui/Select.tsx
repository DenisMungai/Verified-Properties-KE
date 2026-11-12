"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { controlClasses } from "./Field";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<ComponentProps<"select">, "children"> {
  options: readonly SelectOption[];
  /** Optional first, empty option such as "Any county". */
  placeholder?: string;
}

/** Native select for full keyboard and mobile support, styled to match the inputs. */
export function Select({ options, placeholder, className, ...props }: SelectProps) {
  const ref = useRef<HTMLSelectElement>(null);
  const uncontrolledDefault = props.value === undefined && props.defaultValue !== undefined ? String(props.defaultValue) : null;

  /*
   * S22 finding E1: React applies an uncontrolled select's defaultValue only when it mounts, and
   * React 19 resets a form after its action runs. A failed submit put the select back to its
   * placeholder (County, Bedrooms…) while the inputs kept their values. When the default changes
   * (the submitted value comes back), mark that option as the form default and select it. The
   * element stays mounted, so keyboard focus stays put (the Sort select re-renders on every sort).
   */
  useLayoutEffect(() => {
    const select = ref.current;
    if (!select || uncontrolledDefault === null) return;
    for (const option of Array.from(select.options)) option.defaultSelected = option.value === uncontrolledDefault;
    select.value = uncontrolledDefault;
  }, [uncontrolledDefault]);

  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(controlClasses, "h-control appearance-none pr-10", className)}
        {...props}
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-slate-600"
      />
    </div>
  );
}
