import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ChevronRight, ShieldCheck } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import { StatCard } from "@/components/admin/StatCard";
import { EmptyState, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { adminCounts } from "@/db/queries/moderation";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Admin console", robots: { index: false } };

const QUICK_ACTIONS = [
  { href: "/admin/listings", label: "Review listings awaiting moderation" },
  { href: "/admin/reports", label: "Review reported listings" },
] as const;

/** Design "Platform overview". 404 for anyone without an admin role. */
async function Overview() {
  const user = await requireRole(ADMIN_ROLES, "/admin");
  if (!user.roles.includes("platform_admin")) {
    return (
      <EmptyState
        icon={<ShieldCheck />}
        title="Signed in as billing admin"
        description="Payment search, refunds and manual activation arrive in S10. Listing moderation is for platform admins."
      />
    );
  }
  const counts = await adminCounts(getDb());
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Published listings" value={counts.published} note="Live in search" />
        <StatCard label="Pending review" value={counts.pending} note="Needs moderation" href="/admin/listings" />
        <StatCard label="Open reports" value={counts.openReports} note="Reported by users" href="/admin/reports" />
      </div>
      <section aria-labelledby="quick-actions" className="flex flex-col gap-3 rounded-xl bg-mint-50 p-5 md:p-6">
        <h2 id="quick-actions" className="text-h3 text-emerald-700">
          Quick actions
        </h2>
        <ul className="flex flex-col gap-2">
          {QUICK_ACTIONS.map((action) => (
            <li key={action.href}>
              <Link
                href={action.href}
                className="flex min-h-control items-center justify-between rounded-md bg-white px-4 text-body font-medium text-ink hover:text-emerald-700"
              >
                {action.label}
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default function AdminPage() {
  return (
    <>
      <PageHeading title="Platform overview" description="Moderate listings and keep the marketplace trustworthy." />
      <Suspense fallback={<Skeleton className="h-64" />}>
        <Overview />
      </Suspense>
    </>
  );
}
