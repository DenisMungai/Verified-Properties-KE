import type { ReactNode } from "react";
import { Badge } from "@/components/ui";
import type { JobRunRow } from "@/db/queries/job-runs";
import { DELIVERY_KIND_LABELS, type AdminDeliveryKind, type DeliveryCounts, type FailedDelivery } from "@/db/queries/jobs-admin";
import { RUN_BADGES, countsLabel, durationLabel, timeAgo, type RunBadge } from "@/lib/jobs/admin-view";
import { formatNairobiDateTime } from "@/lib/format";

/** Admin Jobs & emails tables (prompt S16), in the billing admin's row style: cards below md. */

const th = "px-4 py-2 font-semibold uppercase tracking-wide";
const td = "px-1 md:px-4 md:py-3";
const row = "flex flex-col gap-0.5 rounded-lg bg-canvas p-3 md:table-row md:p-0";

function Panel({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-line bg-white p-2 md:p-4">{children}</div>;
}

function When({ at, now }: { at: Date; now: Date }) {
  return (
    <time dateTime={at.toISOString()} title={formatNairobiDateTime(at)} className="tabular">
      {timeAgo(at, now)}
    </time>
  );
}

export function RunStatusBadge({ badge }: { badge: RunBadge }) {
  return <Badge tone={RUN_BADGES[badge].tone}>{RUN_BADGES[badge].label}</Badge>;
}

export interface JobRowView {
  job: string;
  schedule: string;
  badge: RunBadge;
  lastRun: JobRunRow | undefined;
  overdue: boolean;
  failures: number;
}

export function JobTable({ rows, now }: { rows: JobRowView[]; now: Date }) {
  return (
    <Panel>
      <table className="w-full border-separate border-spacing-y-2 text-left text-small">
        <caption className="sr-only">Background jobs, their last run and failures in the last 7 days</caption>
        <thead className="hidden text-micro text-slate-600 md:table-header-group">
          <tr>
            <th scope="col" className={th}>Job</th>
            <th scope="col" className={th}>Last run</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={th}>Duration</th>
            <th scope="col" className={th}>Failures (7 days)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((job) => (
            <tr key={job.job} className={row}>
              <td className={`${td} md:rounded-l-lg`}>
                <span className="font-medium text-ink">{job.job}</span>
                <span className="block text-micro text-slate-600">{job.schedule}</span>
              </td>
              <td className={`${td} text-slate-700`}>{job.lastRun ? <When at={job.lastRun.startedAt} now={now} /> : "Never"}</td>
              <td className={td}>
                <span className="flex flex-wrap gap-1.5">
                  <RunStatusBadge badge={job.badge} />
                  {job.overdue && <Badge tone="warning">Overdue</Badge>}
                </span>
              </td>
              <td className={`${td} text-slate-700 tabular`}>
                <span className="md:hidden">Duration </span>
                {durationLabel(job.lastRun?.durationMs ?? null)}
              </td>
              <td className={`${td} tabular md:rounded-r-lg ${job.failures > 0 ? "font-semibold text-danger" : "text-slate-700"}`}>
                <span className="font-normal text-slate-600 md:hidden">Failures (7 days) </span>
                {job.failures}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function FailedRunList({ runs, now, badgeFor }: { runs: JobRunRow[]; now: Date; badgeFor: (run: JobRunRow) => RunBadge }) {
  return (
    <Panel>
      <table className="w-full border-separate border-spacing-y-2 text-left text-small">
        <caption className="sr-only">Failed and partly failed job runs in the last 7 days, newest first</caption>
        <thead className="hidden text-micro text-slate-600 md:table-header-group">
          <tr>
            <th scope="col" className={th}>Started</th>
            <th scope="col" className={th}>Job</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={th}>Details</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className={row}>
              <td className={`${td} text-slate-700 md:rounded-l-lg`}>
                <When at={run.startedAt} now={now} />
              </td>
              <td className={`${td} font-medium text-ink`}>{run.job}</td>
              <td className={td}>
                <RunStatusBadge badge={badgeFor(run)} />
              </td>
              <td className={`${td} break-words text-micro text-slate-600 md:rounded-r-lg`}>
                {run.error && <span className="block font-medium text-danger">{run.error}</span>}
                {countsLabel(run.counts)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function DeliverySummaryTable({ summary }: { summary: Map<AdminDeliveryKind, DeliveryCounts> }) {
  return (
    <Panel>
      <table className="w-full border-separate border-spacing-y-2 text-left text-small">
        <caption className="sr-only">Email and SMS outcomes in the last 24 hours, by kind</caption>
        <thead className="hidden text-micro text-slate-600 md:table-header-group">
          <tr>
            <th scope="col" className={th}>Kind</th>
            <th scope="col" className={th}>Sent</th>
            <th scope="col" className={th}>Skipped</th>
            <th scope="col" className={th}>Failed</th>
          </tr>
        </thead>
        <tbody>
          {[...summary.entries()].map(([kind, counts]) => (
            <tr key={kind} className={row}>
              <td className={`${td} font-medium text-ink md:rounded-l-lg`}>{DELIVERY_KIND_LABELS[kind]}</td>
              <td className={`${td} text-slate-700 tabular`}>
                <span className="md:hidden">Sent </span>
                {counts.sent}
              </td>
              <td className={`${td} text-slate-700 tabular`}>
                <span className="md:hidden">Skipped </span>
                {counts.skipped}
              </td>
              <td className={`${td} tabular md:rounded-r-lg ${counts.failed > 0 ? "font-semibold text-danger" : "text-slate-700"}`}>
                <span className="font-normal text-slate-600 md:hidden">Failed </span>
                {counts.failed}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

export function FailedDeliveryTable({ rows, now }: { rows: FailedDelivery[]; now: Date }) {
  return (
    <Panel>
      <table className="w-full border-separate border-spacing-y-2 text-left text-small">
        <caption className="sr-only">Failed emails and SMS in the last 7 days, newest first</caption>
        <thead className="hidden text-micro text-slate-600 md:table-header-group">
          <tr>
            <th scope="col" className={th}>Last try</th>
            <th scope="col" className={th}>Kind</th>
            <th scope="col" className={th}>Recipient</th>
            <th scope="col" className={th}>Tries</th>
            <th scope="col" className={th}>Next</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((delivery) => (
            <tr key={`${delivery.kind}:${delivery.id}`} className={row}>
              <td className={`${td} text-slate-700 md:rounded-l-lg`}>
                <When at={delivery.at} now={now} />
              </td>
              <td className={td}>
                <span className="font-medium text-ink">{DELIVERY_KIND_LABELS[delivery.kind]}</span>
                {delivery.error && <span className="block text-micro text-danger">{delivery.error}</span>}
              </td>
              <td className={`${td} break-all text-slate-700`}>{delivery.recipient ?? "Lister (SMS)"}</td>
              <td className={`${td} text-slate-700 tabular`}>
                <span className="md:hidden">Tries </span>
                {delivery.attempts}
              </td>
              <td className={`${td} md:rounded-r-lg`}>
                <Badge tone={delivery.willRetry ? "info" : "danger"}>{delivery.willRetry ? "Will retry" : "Gave up"}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
