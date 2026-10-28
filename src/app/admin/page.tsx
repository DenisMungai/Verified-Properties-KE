import type { Metadata } from "next";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { EmptyState, Skeleton } from "@/components/ui";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Admin console", robots: { index: false } };

/** Placeholder proving the role check; 404 for everyone without an admin role. */
async function AdminConsole() {
  const user = await requireRole(ADMIN_ROLES, "/admin");
  return (
    <>
      <h1 className="pb-6 text-h1-sm md:text-h1">Admin console</h1>
      <EmptyState
        icon={<ShieldCheck />}
        title={`Signed in as ${user.roles.includes("platform_admin") ? "platform admin" : "billing admin"}`}
        description="Listing moderation arrives in S8 and billing tools in S10."
      />
    </>
  );
}

export default function AdminPage() {
  return (
    <PageContainer className="py-12">
      <Suspense fallback={<Skeleton className="h-64" />}>
        <AdminConsole />
      </Suspense>
    </PageContainer>
  );
}
