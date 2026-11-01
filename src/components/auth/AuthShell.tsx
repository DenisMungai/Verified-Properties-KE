import type { ReactNode } from "react";
import Image from "next/image";
import { Check } from "lucide-react";
import authImage from "@/assets/images/auth-living-room.jpg";
import { PageContainer } from "@/components/layout/PageContainer";

const POINTS = ["Clear listings", "Reviewed listers", "Better decisions"] as const;

/**
 * Design "04 — Sign In", full-page photo: the photo runs up behind the clear header (67px = 66px
 * bar + 1px border), story text on the left (lg+), form in a white card on the right. Below lg
 * the card stands alone over the photo.
 */
export function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="relative isolate -mt-[67px] flex min-h-dvh items-center overflow-hidden bg-emerald-700 pt-[67px]">
      {/* Decorative; deep green shows while it loads. */}
      <Image
        src={authImage}
        alt=""
        fill
        preload
        placeholder="blur"
        sizes="100vw"
        className="-z-20 object-cover object-center"
      />
      {/* Charcoal wash; from lg it darkens towards the story text on the left. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-ink/55 lg:bg-transparent lg:bg-gradient-to-r lg:from-ink/80 lg:via-ink/50 lg:to-ink/30"
      />
      {/* Top fade behind the clear header's white links. */}
      <div aria-hidden="true" className="absolute inset-x-0 top-0 -z-10 h-40 bg-gradient-to-b from-ink/60 to-transparent" />
      <PageContainer className="grid items-center gap-12 py-8 lg:grid-cols-[minmax(0,1fr)_28rem] lg:py-12">
        <div className="hidden flex-col gap-6 text-white lg:flex">
          <div className="flex flex-col gap-4">
            <p className="max-w-md text-display font-bold text-white">Your next chapter starts with a place.</p>
            <p className="max-w-md text-body text-white/90">
              Save homes you love, manage enquiries and connect with reviewed property professionals.
            </p>
          </div>
          <ul className="flex flex-wrap gap-x-6 gap-y-2 text-body text-white/90">
            {POINTS.map((point) => (
              <li key={point} className="flex items-center gap-2">
                <Check aria-hidden="true" className="size-4 text-white" />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <div className="mx-auto flex w-full max-w-[28rem] flex-col gap-6 rounded-lg border border-line bg-white p-5 sm:p-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-display-sm">{title}</h1>
            <p className="text-body text-slate-600">{subtitle}</p>
          </div>
          {children}
        </div>
      </PageContainer>
    </div>
  );
}
