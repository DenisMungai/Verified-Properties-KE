import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { VerifiedBadge, buttonClasses } from "@/components/ui";
import { SEARCH_PATH } from "@/lib/search/params";
import { CAP_WINDOW, LISTER_CAP, VERIFIED_STRIP_SIZE } from "@/lib/search/ranking";

export const metadata: Metadata = {
  title: "How it works",
  description: "What the Profile verified badge checks, that verification is paid, and how search results are ordered.",
};

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="flex scroll-mt-24 flex-col gap-3">
      <h2 id={`${id}-heading`} className="text-title">
        {title}
      </h2>
      <div className="flex flex-col gap-3 text-body text-slate-700">{children}</div>
    </section>
  );
}

/** The help page behind the ranking disclosure (plan v2.0 §5 "Disclosure"; prompt S7 decision 8). */
export default function HowItWorksPage() {
  return (
    <PageContainer width="text" className="pb-8 pt-6">
      <article className="mx-auto flex max-w-prose flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-micro tracking-wide font-semibold uppercase text-emerald-700">How it works</p>
          <h1 className="text-display-sm">Verification and search ranking</h1>
          <p className="text-body text-slate-600">
            What the badge means, what it costs listers, and how we decide the order of search results.
          </p>
        </header>

        <Section id="verification" title="What “Profile verified” checks">
          <p className="flex flex-wrap items-center gap-2">
            Listers who pass our review show this badge: <VerifiedBadge />
          </p>
          <p>
            It means our team has checked the lister’s identity and business details. The badge is about the person or
            company listing, not about any particular property.
          </p>
        </Section>

        <Section id="paid" title="Verification is a paid service">
          <p>
            Listers pay a monthly fee for verification. Paying starts a review; it never grants the badge by itself. A
            passed review lasts 12 months, and the badge only shows while both the verification fee and the lister’s
            listing plan are paid up.
          </p>
          <p>We can remove a badge at any time for fraud or abuse, whether or not the lister has paid.</p>
        </Section>

        <Section id="ranking" title="How search results are ordered">
          <p>
            <strong className="font-semibold text-ink">Recommended</strong> (the default) shows matching listings from
            verified listers first, then everyone else. Within each group, listings are ordered by how well they match
            your location search, how recently they were published, and their quality: the number of photos and how
            completely they are described.
          </p>
          <p>
            Verified listings with similar scores are shuffled once a day, so the same lister isn’t always first. No
            lister or agency can hold more than {LISTER_CAP} of the first {CAP_WINDOW} results; their other listings
            still appear further down.
          </p>
          <p>
            <strong className="font-semibold text-ink">Newest</strong> and{" "}
            <strong className="font-semibold text-ink">Price</strong> sort strictly by date or price. Above them, up to{" "}
            {VERIFIED_STRIP_SIZE} matching listings from verified listers appear in a strip labelled “Verified listers”.
            They also keep their usual place in the results.
          </p>
          <p>
            Ranking only changes the order. A listing never appears for filters it doesn’t match, however its lister
            pays. On the home page, featured listings come only from verified listers, and are labelled.
          </p>
        </Section>

        <Section id="limits" title="What the badge doesn’t mean">
          <p>
            “Profile verified” is not a licence, a registration with any authority, or a guarantee about a property, its
            price, its condition or its ownership. Always view a property and check its documents before you pay
            anything.
          </p>
        </Section>

        <div>
          <Link href={SEARCH_PATH} className={buttonClasses({ size: "lg" })}>
            Browse properties
          </Link>
        </div>
      </article>
    </PageContainer>
  );
}
