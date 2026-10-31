import type { ReactNode } from "react";
import { Suspense } from "react";
import { AdminNav } from "@/components/admin/AdminNav";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/session";

async function AdminNavLoader() {
  const user = await requireRole(ADMIN_ROLES, "/admin");
  return <AdminNav moderator={user.roles.includes("platform_admin")} />;
}

/** Admin console shell. Every page and action checks its own role as well. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer className="grid gap-6 pb-8 pt-6 lg:grid-cols-[theme(spacing.sidebar)_minmax(0,1fr)] lg:gap-gutter">
      {/* From lg the menu stays in view below the 66px sticky header while the page scrolls (p-1 / -m-1
          keep focus outlines from being clipped by its own scroll box). */}
      <aside className="min-w-0 lg:sticky lg:top-[82px] lg:max-h-[calc(100dvh-98px)] lg:-m-1 lg:self-start lg:overflow-y-auto lg:p-1">
        <Suspense fallback={<Skeleton className="h-control w-full" />}>
          <AdminNavLoader />
        </Suspense>
      </aside>
      <div className="min-w-0">{children}</div>
    </PageContainer>
  );
}
