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
    <PageContainer className="grid gap-6 py-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:py-12">
      <aside>
        <Suspense fallback={<Skeleton className="h-control w-full" />}>
          <AccountNavLoader />
        </Suspense>
      </aside>
      <div className="min-w-0">{children}</div>
    </PageContainer>
  );
}
