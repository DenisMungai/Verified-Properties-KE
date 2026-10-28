import Link from "next/link";
import { Suspense } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCurrentUser } from "@/lib/session";
import { ADMIN_ROLES, LISTER_ROLES, hasAnyRole } from "@/lib/roles";
import { AccountMenu } from "./AccountMenu";
import { Logo } from "./Logo";
import { MobileMenu } from "./MobileMenu";
import { NavLink } from "./NavLink";
import { MAIN_NAV, type HeaderUser } from "./nav";
import { PageContainer } from "./PageContainer";

async function headerUser(): Promise<HeaderUser | null> {
  const user = await getCurrentUser();
  if (!user || !user.emailVerified) return null;
  return {
    name: user.name,
    isLister: hasAnyRole(user.roles, LISTER_ROLES),
    isAdmin: hasAnyRole(user.roles, ADMIN_ROLES),
  };
}

/** Reads the session, so it streams in behind <Suspense> (Cache Components). */
async function DesktopActions() {
  const user = await headerUser();
  if (user) return <AccountMenu user={user} />;
  return (
    <>
      <Link href="/sign-in" className={buttonClasses({ variant: "secondary" })}>
        Log in
      </Link>
      <Link href="/sign-up" className={buttonClasses()}>
        Get started
      </Link>
    </>
  );
}

async function MobileActions() {
  return <MobileMenu user={await headerUser()} />;
}

/** Design: white 72px bar, green wordmark, Explore, Log in (secondary) + Get started (primary). */
export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-white">
      <PageContainer className="flex h-header items-center gap-6">
        <Logo />
        <nav aria-label="Main" className="ml-auto hidden md:block">
          <ul className="flex items-center gap-2">
            {MAIN_NAV.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  className="inline-flex min-h-control items-center rounded-md px-3 text-body-sm font-medium text-slate-700 hover:text-ink"
                  activeClassName="text-emerald-700"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <Suspense fallback={<Skeleton className="h-control w-56" />}>
            <DesktopActions />
          </Suspense>
        </div>
        <div className="ml-auto md:hidden">
          <Suspense fallback={<Skeleton className="size-control" />}>
            <MobileActions />
          </Suspense>
        </div>
      </PageContainer>
    </header>
  );
}
