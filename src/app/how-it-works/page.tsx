import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton, VerifiedBadge, buttonClasses } from "@/components/ui";
import { GetVerifiedLink, VerificationPrice } from "@/components/verification/PublicOffer";
import { BILLING_PERIOD_DAYS, GRACE_DAYS } from "@/lib/billing/constants";
import { SEARCH_PATH } from "@/lib/search/params";
import { CAP_WINDOW, FEATURED_MIN_PHOTOS, HOME_PER_LISTER, LISTER_CAP, VERIFIED_STRIP_SIZE } from "@/lib/search/ranking";
import {
  RETENTION_DAYS_AFTER_END,
  RETENTION_DAYS_AFTER_REJECTION,
  RETENTION_MONTHS_AFTER_SUSPENSION,
} from "@/lib/verification/retention";
import {
  DOCUMENT_LABELS,
  REVIEW_TARGET_WORKING_DAYS,
  REREVIEW_WINDOW_DAYS,
  REVIEW_VALID_MONTHS,
  requiredDocumentTypes,
  type DocumentType,
} from "@/lib/verification/rules";

export const metadata: Metadata = {
  title: "How it works",
  description: "What the Profile verified badge checks, what it costs, and how search and the home page are ordered.",
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

const BASE_DOCUMENTS = requiredDocumentTypes("owner", false);
const extraFor = (types: DocumentType[]) => types.filter((type) => !BASE_DOCUMENTS.includes(type));

/** Who sends what, from the same rule the upload page enforces (prompt S12 decision 1). */
const DOCUMENT_ROWS: { who: string; types: DocumentType[] }[] = [
  { who: "Every lister", types: BASE_DOCUMENTS },
  { who: "Agents also send", types: extraFor(requiredDocumentTypes("agent", false)) },
  { who: "Developers and agency members also send", types: extraFor(requiredDocumentTypes("developer", true)) },
];

function DocumentList() {
  return (
    <ul className="flex flex-col gap-2">
      {DOCUMENT_ROWS.map((row) => (
        <li key={row.who} className="rounded-sm border border-line bg-white p-3">
          <p className="text-small font-semibold text-ink">{row.who}</p>
          <p className="text-small text-slate-600">{row.types.map((type) => DOCUMENT_LABELS[type].label).join(", ")}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * The help page behind the disclosures (plan v2.0 §5 "Disclosure", §10; prompts S7 decision 8 and
 * S14 decision 7). The price and the CTA are read at request time; everything else is static.
 */
export default function HowItWorksPage() {
  return (
    <PageContainer width="text" className="pb-8 pt-6">
      <article className="mx-auto flex max-w-prose flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-micro tracking-wide font-semibold uppercase text-emerald-700">How it works</p>
          <h1 className="text-display-sm">Verification and search ranking</h1>
          <p className="text-body text-slate-600">
            What the badge means, what it costs listers, and how we decide the order of search results and the home page.
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
          <p>To be reviewed, listers send us these documents:</p>
          <DocumentList />
          <p>
            Our team usually decides within {REVIEW_TARGET_WORKING_DAYS} working days. Documents are stored privately and
            seen only by our review team; they are never shown on the site. We delete them {RETENTION_DAYS_AFTER_END} days
            after a review ends, {RETENTION_DAYS_AFTER_REJECTION} days after a review is declined, or{" "}
            {RETENTION_MONTHS_AFTER_SUSPENSION} months after a badge is suspended.
          </p>
        </Section>

        <Section id="paid" title="What verification costs">
          <p>
            Verification is a monthly add-on, paid with M-Pesa on top of a listing plan:{" "}
            <Suspense
              fallback={<span aria-hidden="true" className="inline-block h-4 w-40 animate-pulse rounded-md bg-surface-muted align-middle" />}
            >
              <VerificationPrice />
            </Suspense>
          </p>
          <p>
            Paying starts a review; it never grants the badge by itself. A passed review lasts {REVIEW_VALID_MONTHS}{" "}
            months, and the badge only shows while both the verification fee and the lister’s listing plan are paid up.
            From {REREVIEW_WINDOW_DAYS} days before a review runs out, the lister can start a new review at no extra
            charge.
          </p>
          <p>If a review is declined, the first month’s verification fee is credited to the lister’s listing plan.</p>
          <p>
            Each payment covers {BILLING_PERIOD_DAYS} days. If a payment lapses, the badge stays for a {GRACE_DAYS}-day
            grace period. After that, the badge, the higher ranking, featured placement and the open contact details are
            removed. They come back as soon as the lister pays again, as long as their review is still valid.
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
          <p>Ranking only changes the order. A listing never appears for filters it doesn’t match, however its lister pays.</p>
        </Section>

        <Section id="featured" title="Featured on the home page">
          <p>
            Featured listings on the home page come only from verified listers, and carry a “Featured” label. To be
            featured, a listing needs at least {FEATURED_MIN_PHOTOS} photos, a cover photo and a complete description.
          </p>
          <p>
            Each lister or agency can have at most {HOME_PER_LISTER} featured listings in each home page section, and
            the choice rotates once a day. When there aren’t enough verified listings, the remaining places show the
            newest listings, without the label.
          </p>
        </Section>

        <Section id="limits" title="What the badge doesn’t mean">
          <p>
            “Profile verified” is not a licence, a registration with any authority, or a guarantee about a property, its
            price, its condition or its ownership. Always view a property and check its documents before you pay
            anything.
          </p>
        </Section>

        <div className="flex flex-wrap gap-3">
          <Link href={SEARCH_PATH} className={buttonClasses({ size: "lg" })}>
            Browse properties
          </Link>
          <Suspense fallback={<Skeleton className="h-control-lg w-36 rounded-lg" />}>
            <GetVerifiedLink />
          </Suspense>
        </div>
      </article>
    </PageContainer>
  );
}
