import Link from "next/link";
import { Suspense } from "react";
import { buttonClasses } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { getCurrentUser } from "@/lib/session";
import { ADMIN_ROLES, LISTER_ROLES, hasAnyRole } from "@/lib/roles";
import { AccountMenu } from "./AccountMenu";
import { HeaderOverlayFlag } from "./HeaderOverlayFlag";
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

/**
 * Compact sticky bar (66px): wordmark left, nav centred, account actions right. Below md the
 * nav moves into the slide-out drawer. On the home page at the top it is clear over the hero
 * photo (HeaderOverlayFlag); the `group-has-[[data-header-overlay]]/header` classes are that state.
 */
export function SiteHeader() {
  return (
    <header className="group/header sticky top-0 z-40 min-h-[66px] border-b border-line bg-white/95 backdrop-blur transition-colors duration-200 has-[[data-header-overlay]]:border-transparent has-[[data-header-overlay]]:bg-transparent has-[[data-header-overlay]]:backdrop-blur-none print:hidden">
      <Suspense fallback={null}>
        <HeaderOverlayFlag />
      </Suspense>
      <PageContainer className="flex h-[66px] items-center gap-4 md:grid md:grid-cols-[1fr_auto_1fr]">
        <Logo overlay className="justify-self-start" />
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-4">
            {MAIN_NAV.map((item) => (
              <li key={item.href}>
                <NavLink
                  href={item.href}
                  className="inline-flex min-h-control items-center rounded-md px-1 text-[10px] font-medium text-slate-700 transition-colors hover:text-ink group-has-[[data-header-overlay]]/header:text-white/90 group-has-[[data-header-overlay]]/header:hover:text-white 2xl:text-small"
                  activeClassName="font-semibold text-emerald-700 group-has-[[data-header-overlay]]/header:text-white group-has-[[data-header-overlay]]/header:underline group-has-[[data-header-overlay]]/header:decoration-2 group-has-[[data-header-overlay]]/header:underline-offset-8"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <div className="hidden items-center justify-end gap-2 md:flex">
          <Suspense fallback={<Skeleton className="h-control w-48" />}>
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
