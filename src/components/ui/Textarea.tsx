import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { controlClasses } from "./Field";

export function Textarea({ className, rows = 5, ...props }: ComponentProps<"textarea">) {
  return <textarea rows={rows} className={cn(controlClasses, "py-3", className)} {...props} />;
}
