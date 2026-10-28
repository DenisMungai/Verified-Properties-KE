import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** 1280px max width, 16 / 24 / 32px side padding (design system §3.2). */
export function PageContainer({
  as: Tag = "div",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag className={cn("mx-auto w-full max-w-container px-4 md:px-6 lg:px-8", className)}>
      {children}
    </Tag>
  );
}
