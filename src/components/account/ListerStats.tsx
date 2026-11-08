import { formatNairobiDate } from "@/lib/format";
import { changeLabel, changeWords, LISTING_VIEWS_SINCE, type Change } from "@/lib/stats/engagement";
import type { ComparisonRow, ListerStats, StatFigure } from "@/lib/stats/load";
import { viewBadge, viewShortLine, type ListerView } from "@/lib/verification/view";
import { StatCard } from "./StatCard";

/**
 * Lister dashboard numbers (prompt S13 decision 13): enquiries, property views and verification
 * cards, and the "Since you were verified" comparison. Server components; data comes in as props.
 */

const PERIOD = "previous 30 days";
const viewsSince = formatNairobiDate(new Date(`${LISTING_VIEWS_SINCE}T00:00:00+03:00`));

function ChangeLine({ change, noun }: { change: Change; noun: string }) {
  const label = changeLabel(change, PERIOD);
  if (!label) return <>No {noun} in the {PERIOD}</>;
  return (
    <>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{changeWords(change, PERIOD)}</span>
    </>
  );
}

function figureLine(figure: StatFigure, noun: string) {
  if (!figure.change) return { line: <>Counting since {viewsSince}</>, tone: "muted" as const };
  return { line: <ChangeLine change={figure.change} noun={noun} />, tone: figure.change.kind === "up" ? ("positive" as const) : ("muted" as const) };
}

const count = (n: number) => n.toLocaleString("en-KE");

export function EngagementCards({ stats, verification }: { stats: ListerStats; verification: ListerView | null }) {
  const enquiries = figureLine(stats.enquiries, "enquiries");
  const views = figureLine(stats.views, "views");
  return (
    <>
      <StatCard id="enquiries-stat" label="Enquiries (30 days)" value={count(stats.enquiries.total)} line={enquiries.line} lineTone={enquiries.tone} link={{ href: "/account/messages", label: "View messages" }} />
      <StatCard id="views-stat" label="Property views (30 days)" value={count(stats.views.total)} line={views.line} lineTone={views.tone} link={{ href: "/account/listings", label: "Views by listing" }} />
      {verification && (
        <StatCard
          id="verification-stat"
          label="Verification"
          value={viewBadge(verification).label}
          valueSize="title"
          line={viewShortLine(verification)}
          lineTone={verification.state === "verified" && verification.badgeLive ? "positive" : "muted"}
          link={{ href: "/account/verification", label: verification.state === "not_started" ? "Get verified" : "Go to verification" }}
        />
      )}
    </>
  );
}

const METRIC_LABELS: Record<ComparisonRow["metric"], string> = { views: "Property views", saves: "Saves", enquiries: "Enquiries" };

function avg(value: number | null): string {
  return value === null ? "Not tracked yet" : value.toLocaleString("en-KE", { maximumFractionDigits: 1 });
}

function RowChange({ change }: { change: Change | null }) {
  if (!change) return <span className="text-slate-600">—</span>;
  if (change.kind === "no_baseline") return <span className="text-slate-600">New since verification</span>;
  const label = change.kind === "up" ? `+${change.percent}%` : change.kind === "down" ? `−${change.percent}%` : "No change";
  return (
    <span className={change.kind === "up" ? "text-emerald-700" : "text-slate-600"}>
      <span aria-hidden="true">{label}</span>
      <span className="sr-only">{changeWords(change, "before verification")}</span>
    </span>
  );
}

export function ComparisonPanel({ comparison }: { comparison: ListerStats["comparison"] }) {
  if (comparison.kind === "none") return null;
  return (
    <section aria-labelledby="since-verified-heading" className="flex flex-col gap-3 rounded-lg border border-line bg-white p-5">
      <h2 id="since-verified-heading" className="text-title">
        Since you were verified
      </h2>
      {comparison.kind === "too_soon" ? (
        <p className="text-small text-slate-700">
          You were first approved on {formatNairobiDate(comparison.firstApprovedAt)}. Your comparison appears 7 days after approval.
        </p>
      ) : (
        <>
          <p className="text-small text-slate-700">
            Average per day: the 30 days before your first approval on {formatNairobiDate(comparison.firstApprovedAt)}, against the
            last {comparison.afterDays} days.
          </p>
          <table className="hidden w-full border-separate border-spacing-y-2 text-small sm:table">
            <caption className="sr-only">Average per day before and since verification</caption>
            <thead>
              <tr className="text-left text-micro text-slate-600">
                <th scope="col" className="px-4 pb-1 font-semibold uppercase tracking-wide">Metric</th>
                <th scope="col" className="px-4 pb-1 font-semibold uppercase tracking-wide">Before</th>
                <th scope="col" className="px-4 pb-1 font-semibold uppercase tracking-wide">Since</th>
                <th scope="col" className="px-4 pb-1 font-semibold uppercase tracking-wide">Change</th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((row) => (
                <tr key={row.metric}>
                  <th scope="row" className="rounded-l-lg bg-canvas px-4 py-3 text-left font-medium text-ink">{METRIC_LABELS[row.metric]}</th>
                  <td className="bg-canvas px-4 py-3 tabular text-slate-700">{avg(row.before)}</td>
                  <td className="bg-canvas px-4 py-3 tabular text-ink">{avg(row.after)}</td>
                  <td className="rounded-r-lg bg-canvas px-4 py-3">
                    <RowChange change={row.change} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <ul className="flex flex-col gap-2 sm:hidden">
            {comparison.rows.map((row) => (
              <li key={row.metric} className="flex flex-col gap-1 rounded-sm bg-canvas p-3">
                <span className="text-small font-medium text-ink">{METRIC_LABELS[row.metric]}</span>
                <span className="text-small tabular text-slate-700">
                  Before: {avg(row.before)} · Since: {avg(row.after)}
                </span>
                {row.change && (
                  <span className="text-small">
                    <RowChange change={row.change} />
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="text-micro text-slate-600">Saves count homes that are still saved; unsaving removes them.</p>
        </>
      )}
    </section>
  );
}
