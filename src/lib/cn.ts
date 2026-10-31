import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the custom type scale, otherwise `text-small` and `text-ink` are
 * treated as the same group and one silently drops the other. The custom spacing keys let
 * `h-8` override `h-control` (and similar) when a caller narrows a control.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      spacing: ["control", "control-lg", "gutter", "sidebar", "page-x"],
    },
    classGroups: {
      "font-size": [{ text: ["display", "display-sm", "title", "body", "small", "micro"] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
