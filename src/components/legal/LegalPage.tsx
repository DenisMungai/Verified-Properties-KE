import Link from "next/link";
import type { ReactNode } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { formatNairobiDate } from "@/lib/format";
import { DATA_REQUEST_PATH, LEGAL, LEGAL_LAST_UPDATED } from "@/lib/legal";

/**
 * Shared layout for the legal pages (prompt S20 decision 2, UI spec): the how-it-works prose
 * column, a contents list, and the Draft notice until `LEGAL.effectiveDate` is set. Static, so
 * the pages prerender.
 */

export interface LegalSection {
  id: string;
  title: string;
  body: ReactNode;
}

const asDate = (iso: string) => formatNairobiDate(new Date(`${iso}T09:00:00+03:00`));

export function LegalPage({ title, intro, sections }: { title: string; intro: ReactNode; sections: LegalSection[] }) {
  return (
    <PageContainer width="text" className="pb-8 pt-6">
      <article className="mx-auto flex max-w-prose flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-micro font-semibold uppercase tracking-wide text-emerald-700">Legal</p>
          <h1 className="text-display-sm">{title}</h1>
          <div className="text-body text-slate-700">{intro}</div>
          <p className="text-micro text-slate-600">
            {LEGAL.effectiveDate ? `In force from ${asDate(LEGAL.effectiveDate)}. ` : ""}Last updated {asDate(LEGAL_LAST_UPDATED)}.
          </p>
        </header>

        {!LEGAL.effectiveDate && (
          <p className="rounded-lg border border-line bg-mint-50 p-5 text-small text-ink">
            <strong className="font-semibold">Draft.</strong> This document is being reviewed and isn&apos;t in force yet. It
            describes how VerifiedPropertiesKE works today.
          </p>
        )}

        <nav aria-label="On this page" className="flex flex-col gap-1">
          <h2 className="text-small font-semibold text-ink">On this page</h2>
          <ul className="flex flex-col sm:grid sm:grid-cols-2 sm:gap-x-6">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="inline-flex min-h-control items-center text-small text-emerald-700 underline-offset-4 hover:underline"
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {sections.map((section) => (
          <section key={section.id} id={section.id} aria-labelledby={`${section.id}-heading`} className="flex scroll-mt-24 flex-col gap-3">
            <h2 id={`${section.id}-heading`} className="text-title">
              {section.title}
            </h2>
            <div className="flex flex-col gap-3 text-body text-slate-700">{section.body}</div>
          </section>
        ))}
      </article>
    </PageContainer>
  );
}

/** A bulleted list in the legal prose style. */
export function Bullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="flex list-disc flex-col gap-2 pl-5">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

/** Bordered items, for lists of named things (processors, request kinds). */
export function Cards({ items }: { items: { title: string; body: ReactNode }[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.title} className="rounded-sm border border-line bg-white p-3">
          <p className="text-small font-semibold text-ink">{item.title}</p>
          <div className="text-small text-slate-600">{item.body}</div>
        </li>
      ))}
    </ul>
  );
}

/** An in-prose link with the legal pages' link style. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="font-medium text-emerald-700 underline underline-offset-4 hover:no-underline">
      {children}
    </Link>
  );
}

/** How to reach us: the request form, plus the email and address when they are set. */
export function ContactLine() {
  return (
    <>
      Use the <TextLink href={DATA_REQUEST_PATH}>request form</TextLink> while signed in
      {LEGAL.contactEmail ? (
        <>
          , or email{" "}
          <a href={`mailto:${LEGAL.contactEmail}`} className="font-medium text-emerald-700 underline underline-offset-4 hover:no-underline">
            {LEGAL.contactEmail}
          </a>
        </>
      ) : null}
      {LEGAL.postalAddress ? `. Post: ${LEGAL.postalAddress}` : ""}.
    </>
  );
}

/** " You can also email … / write to …", only when those facts are set; otherwise nothing. */
export function AlsoContact() {
  if (!LEGAL.contactEmail && !LEGAL.postalAddress) return null;
  return (
    <>
      {" "}
      You can also{" "}
      {LEGAL.contactEmail ? (
        <>
          email{" "}
          <a href={`mailto:${LEGAL.contactEmail}`} className="font-medium text-emerald-700 underline underline-offset-4 hover:no-underline">
            {LEGAL.contactEmail}
          </a>
        </>
      ) : null}
      {LEGAL.contactEmail && LEGAL.postalAddress ? " or " : ""}
      {LEGAL.postalAddress ? `write to ${LEGAL.postalAddress}` : ""}.
    </>
  );
}

/** "VerifiedPropertiesKE" or "VerifiedPropertiesKE, run by <operator>". */
export function OperatorLine() {
  return LEGAL.operatorName ? (
    <>VerifiedPropertiesKE is run by {LEGAL.operatorName}</>
  ) : (
    <>VerifiedPropertiesKE is the website at verifiedpropertieske.vercel.app</>
  );
}
