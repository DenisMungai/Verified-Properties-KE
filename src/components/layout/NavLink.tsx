"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { cn } from "@/lib/cn";

interface NavLinkProps {
  href: string;
  exact?: boolean;
  className?: string;
  activeClassName?: string;
  children: ReactNode;
}

function ActiveAwareLink({ href, exact = true, className, activeClassName, children }: NavLinkProps) {
  const pathname = usePathname();
  const active = exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cn(className, active && activeClassName)}>
      {children}
    </Link>
  );
}

/**
 * Link that marks itself `aria-current="page"` when it matches the current route. Under Cache
 * Components, `usePathname` suspends on routes with unknown dynamic params (e.g. /account/listings/[id]),
 * so the plain, inactive link is the prerendered fallback.
 */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense
      fallback={
        <Link href={props.href} className={props.className}>
          {props.children}
        </Link>
      }
    >
      <ActiveAwareLink {...props} />
    </Suspense>
  );
}
