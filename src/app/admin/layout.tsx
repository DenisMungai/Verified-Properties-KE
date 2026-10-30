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
    <PageContainer className="grid gap-6 py-8 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-10 lg:py-12">
      <aside className="min-w-0">
        <Suspense fallback={<Skeleton className="h-control w-full" />}>
          <AdminNavLoader />
        </Suspense>
      </aside>
      <div className="min-w-0">{children}</div>
    </PageContainer>
  );
}
