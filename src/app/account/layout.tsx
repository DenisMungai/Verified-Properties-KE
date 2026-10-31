import type { ReactNode } from "react";
import { Suspense } from "react";
import { AccountNav } from "@/components/account/AccountNav";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui/Skeleton";
import { ADMIN_ROLES, LISTER_ROLES, hasAnyRole } from "@/lib/roles";
import { requireUser } from "@/lib/session";

async function AccountNavLoader() {
  const user = await requireUser();
  return (
    <AccountNav
      user={{ name: user.name, isLister: hasAnyRole(user.roles, LISTER_ROLES), isAdmin: hasAnyRole(user.roles, ADMIN_ROLES) }}
    />
  );
}

export default function AccountLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer className="grid gap-6 pb-8 pt-6 lg:grid-cols-[theme(spacing.sidebar)_minmax(0,1fr)] lg:gap-gutter print:block print:py-0">
      {/* min-w-0: the nav's scrolling tab row must not widen the single mobile column. From lg the
          menu stays in view below the 66px sticky header while the page scrolls (p-1 / -m-1 keep focus
          outlines from being clipped by its own scroll box). */}
      <aside className="min-w-0 lg:sticky lg:top-[82px] lg:max-h-[calc(100dvh-98px)] lg:-m-1 lg:self-start lg:overflow-y-auto lg:p-1 print:hidden">
        <Suspense fallback={<Skeleton className="h-control w-full" />}>
          <AccountNavLoader />
        </Suspense>
      </aside>
      <div className="min-w-0">{children}</div>
    </PageContainer>
  );
}
