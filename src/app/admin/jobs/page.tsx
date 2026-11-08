import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { CircleCheck } from "lucide-react";
import { PageHeading } from "@/components/account/PageHeading";
import {
  DeliverySummaryTable,
  FailedDeliveryTable,
  FailedRunList,
  JobTable,
  type JobRowView,
} from "@/components/admin/jobs/JobTables";
import { EmptyState, Skeleton } from "@/components/ui";
import { getDb } from "@/db";
import { failedRuns, jobOverview, type JobRunRow } from "@/db/queries/job-runs";
import { deliverySummary, failedDeliveries } from "@/db/queries/jobs-admin";
import { isOverdue, runBadge } from "@/lib/jobs/admin-view";
import { JOB_INTERVAL_MS, JOB_SCHEDULES } from "@/lib/jobs/schedules";
import { JOB_NAMES } from "@/lib/jobs/types";
import { ADMIN_ROLES } from "@/lib/roles";
import { requireRole } from "@/lib/session";

export const metadata: Metadata = { title: "Jobs & emails", robots: { index: false } };

const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 50;

function Section({ id, title, description, children }: { id: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="text-title">
          {title}
        </h2>
        {description && <p className="text-small text-slate-600">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/** Read-only (prompt S16 decision 12): retries are automatic; operators can still use jobs:run. */
async function JobsContent() {
  await requireRole(ADMIN_ROLES, "/admin/jobs");
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const db = getDb();
  const [overview, runs, summary, deliveries] = await Promise.all([
    jobOverview(db, weekAgo),
    failedRuns(db, weekAgo, LIST_LIMIT),
    deliverySummary(db, new Date(now.getTime() - DAY_MS)),
    failedDeliveries(db, weekAgo, LIST_LIMIT),
  ]);

  const jobs: JobRowView[] = JOB_NAMES.map((job) => {
    const lastRun = overview.latest.get(job);
    return {
      job,
      schedule: `${JOB_SCHEDULES[job].nairobi} (Nairobi)`,
      badge: runBadge(lastRun, now),
      lastRun,
      overdue: isOverdue(overview.lastFinished.get(job), Boolean(lastRun), JOB_INTERVAL_MS[job], now),
      failures: overview.failures.get(job) ?? 0,
    };
  });
  const badgeFor = (run: JobRunRow) => runBadge(run, now);

  return (
    <div className="flex flex-col gap-8">
      <Section id="jobs-heading" title="Jobs" description="QStash retries a failed run 3 times with backoff. Overdue means no finished run in twice the usual interval.">
        <JobTable rows={jobs} now={now} />
      </Section>
      <Section id="failed-runs-heading" title="Failed runs (last 7 days)">
        {runs.length === 0 ? (
          <EmptyState icon={<CircleCheck />} title="No failed runs in the last 7 days." />
        ) : (
          <FailedRunList runs={runs} now={now} badgeFor={badgeFor} />
        )}
      </Section>
      <Section id="emails-heading" title="Emails" description="Outcomes in the last 24 hours. Failed message alerts and receipts retry after about 10 and 20 minutes.">
        <DeliverySummaryTable summary={summary} />
        {deliveries.length === 0 ? (
          <EmptyState icon={<CircleCheck />} title="No failed emails in the last 7 days." />
        ) : (
          <FailedDeliveryTable rows={deliveries} now={now} />
        )}
      </Section>
    </div>
  );
}

export default function JobsAdminPage() {
  return (
    <>
      <PageHeading title="Jobs & emails" description="Background job health and email delivery. Recipients are masked." />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <JobsContent />
      </Suspense>
    </>
  );
}
