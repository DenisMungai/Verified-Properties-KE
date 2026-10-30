import Link from "next/link";

/** Design "Platform overview" stat card: label, big number, a link to act on it. */
export function StatCard({ label, value, note, href }: { label: string; value: number; note: string; href?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-5 shadow-card">
      <p className="text-body-sm text-slate-600">{label}</p>
      <p className="text-h1 font-bold text-ink">{value.toLocaleString("en-KE")}</p>
      {href ? (
        <Link href={href} className="-my-3 inline-flex min-h-control items-center self-start text-body-sm font-medium text-emerald-700 hover:underline">
          {note}
        </Link>
      ) : (
        <p className="text-body-sm text-emerald-700">{note}</p>
      )}
    </div>
  );
}
