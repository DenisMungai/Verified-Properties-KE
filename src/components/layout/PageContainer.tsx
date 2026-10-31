import type { ElementType, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** 1440px shell (1160px for text-heavy pages); 16 / 20px side padding, then 4vw from md. */
export function PageContainer({
  as: Tag = "div",
  width = "page",
  className,
  children,
}: {
  as?: ElementType;
  width?: "page" | "text";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Tag
      className={cn(
        "mx-auto w-full px-4 sm:px-5 md:px-page-x",
        width === "page" ? "max-w-page" : "max-w-text",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
