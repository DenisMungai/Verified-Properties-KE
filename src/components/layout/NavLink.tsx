"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Link that marks itself `aria-current="page"` when it matches the current route. */
export function NavLink({
  href,
  exact = true,
  className,
  activeClassName,
  children,
}: {
  href: string;
  exact?: boolean;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(className, active && activeClassName)}>
      {children}
    </Link>
  );
}
