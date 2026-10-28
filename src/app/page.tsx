import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { buttonClasses } from "@/components/ui";

/** Placeholder until the real home page and search (S7). Copy from "01 — Homepage". */
export default function HomePage() {
  return (
    <PageContainer className="grid items-center gap-10 py-16 lg:grid-cols-2 lg:py-24">
      <div className="flex flex-col items-start gap-6">
        <p className="text-label uppercase text-emerald-700">Kenya property marketplace</p>
        <h1 className="text-display-sm md:text-display">Find a place to call your own.</h1>
        <p className="max-w-prose text-body-lg text-slate-600">
          Discover homes, apartments and land from property professionals you can trust.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/sign-up" className={buttonClasses({ size: "lg" })}>
            Get started
          </Link>
          <Link href="/sign-up?intent=list" className={buttonClasses({ size: "lg", variant: "secondary" })}>
            List your property
          </Link>
        </div>
      </div>
      <div aria-hidden="true" className="flex h-72 items-end justify-center rounded-2xl bg-mint-50 px-10 pt-12 lg:h-96">
        <div className="relative flex h-4/5 w-full max-w-sm items-end justify-center rounded-t-xl bg-[#C9DDCF]">
          <div className="absolute inset-x-8 top-10 bottom-0 rounded-t-lg bg-canvas" />
          <div className="absolute left-14 top-16 size-12 rounded-sm bg-[#B7D2BF]" />
          <div className="absolute right-14 top-16 size-12 rounded-sm bg-[#B7D2BF]" />
          <div className="relative h-28 w-16 rounded-t-sm bg-emerald-700" />
        </div>
      </div>
    </PageContainer>
  );
}
