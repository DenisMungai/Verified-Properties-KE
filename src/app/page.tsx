import Link from "next/link";
import { BadgeCheck } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { buttonClasses } from "@/components/ui";
import { BRAND } from "@/lib/brand";

/** Placeholder until the real home page (slice S7). */
export default function HomePage() {
  return (
    <PageContainer className="flex min-h-[70vh] flex-col items-start justify-center gap-6 py-16">
      <span className="inline-flex items-center gap-2 text-label uppercase text-emerald-700">
        <BadgeCheck aria-hidden="true" className="size-4" />
        Foundation build
      </span>
      <h1 className="text-display-sm md:text-display">{BRAND.name}</h1>
      <p className="max-w-prose text-body-lg text-slate-700">{BRAND.tagline}</p>
      <p className="max-w-prose text-body text-slate-600">{BRAND.description}</p>
      <Link href="/styleguide" className={buttonClasses({ size: "lg" })}>
        View the style guide
      </Link>
    </PageContainer>
  );
}
