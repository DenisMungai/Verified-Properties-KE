import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { BRAND } from "@/lib/brand";

const POINTS = ["Clear listings", "Reviewed listers", "Better decisions"] as const;

/** Decorative house from the design: tinted rounded rectangles, hidden from assistive tech. */
function HouseIllustration() {
  return (
    <div aria-hidden="true" className="relative flex h-56 items-end justify-center rounded-lg bg-white/10 px-10 pt-10">
      <div className="relative flex h-full w-full max-w-xs items-end justify-center rounded-t-lg bg-[#DCE8DF]">
        <div className="absolute left-8 top-8 size-10 rounded-sm bg-[#B7D2BF]" />
        <div className="absolute right-8 top-8 size-10 rounded-sm bg-[#B7D2BF]" />
        <div className="h-24 w-14 rounded-t-sm bg-emerald-700" />
      </div>
    </div>
  );
}

/**
 * Design "04 — Sign In": deep-green story panel on the left (lg+), form on warm canvas on the
 * right. Below lg the form stands alone.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh-66px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden flex-col gap-6 bg-emerald-700 px-10 py-12 text-white lg:flex">
        <p className="text-title font-bold text-white">{BRAND.name}</p>
        <div className="flex flex-col gap-4">
          <p className="max-w-md text-display font-bold text-white">Your next chapter starts with a place.</p>
          <p className="max-w-md text-body text-white/90">
            Save homes you love, manage enquiries and connect with reviewed property professionals.
          </p>
        </div>
        <HouseIllustration />
        <ul className="flex flex-wrap gap-x-6 gap-y-2 text-body text-white/90">
          {POINTS.map((point) => (
            <li key={point} className="flex items-center gap-2">
              <Check aria-hidden="true" className="size-4 text-white" />
              {point}
            </li>
          ))}
        </ul>
      </aside>
      <div className="flex items-start justify-center bg-canvas px-4 py-10 md:px-6 lg:items-center lg:px-12">
        <div className="flex w-full max-w-[28rem] flex-col gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-display-sm">{title}</h1>
            <p className="text-body text-slate-600">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
