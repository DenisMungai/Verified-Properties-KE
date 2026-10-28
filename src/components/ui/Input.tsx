import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";
import { controlClasses } from "./Field";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} className={cn(controlClasses, "h-control", className)} {...props} />;
}
