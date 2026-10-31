import type { ComponentProps } from "react";
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
  return (
    <div className="relative">
      <select
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
