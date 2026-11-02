import type { ReactNode } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import livingRoomImage from "@/assets/images/auth-living-room.jpg";
import { BRAND } from "@/lib/brand";

const POINTS = ["Clear listings", "Reviewed listers", "Better decisions"] as const;

/**
 * Design "04 — Sign In": deep-green story panel on the left (lg+) with a decorative living-room
 * photo, form on warm canvas on the right, under the solid header. Below lg the form stands alone.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="grid min-h-[calc(100dvh-67px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="hidden bg-emerald-700 px-10 py-14 text-white lg:flex xl:px-16">
        <div className="flex w-full max-w-[34rem] flex-col gap-8">
          <p className="text-title font-bold text-white">{BRAND.name}</p>
          <div className="flex flex-col gap-4">
            <p className="max-w-sm text-display-sm text-white">Your next chapter starts with a place.</p>
            <p className="max-w-md text-body text-white/90">
              Save homes you love, manage enquiries and connect with reviewed property professionals.
            </p>
          </div>
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg bg-emerald-600">
            <Image
              src={livingRoomImage}
              alt=""
              fill
              placeholder="blur"
              sizes="(min-width: 1280px) 34rem, 45vw"
              className="object-cover object-center"
            />
          </div>
          <div className="flex items-center gap-3 text-body text-white/90">
            <Check aria-hidden="true" className="size-4 shrink-0 text-white" />
            <ul className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {POINTS.map((point, index) => (
                <li key={point} className="flex items-center gap-3">
                  {index > 0 && <span aria-hidden="true">·</span>}
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </aside>
      <div className="flex justify-center bg-canvas px-4 py-10 md:px-6 lg:px-12 lg:pt-28">
        <div className="flex w-full max-w-[32rem] flex-col gap-6">
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
