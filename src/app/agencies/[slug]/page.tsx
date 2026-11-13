import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense, cache } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { ContactButtons } from "@/components/listing/ContactButtons";
import { Pagination } from "@/components/search/Pagination";
import { CARD_GRID, PropertyCard, PropertyGridSkeleton } from "@/components/search/PropertyCard";
import { saveContextFor, saveProps, toCardData } from "@/components/search/card-data";
import { Avatar, Skeleton, VerifiedBadge, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { getAgencyOffice, getPublicAgency, getPublicTeam, type PublicAgency } from "@/db/queries/public-agencies";
import { agencyListings } from "@/db/queries/public-listings";
import { getServerEnv } from "@/lib/env";
import { hasAnyContact, NO_CONTACT_POINT } from "@/lib/listings/contact";
import { isGoogleMapsUrl } from "@/lib/listings/map-link";
import { LISTER_TYPE_LABELS } from "@/lib/roles";
import { signInPath } from "@/lib/safe-redirect";
import { single, type SearchParams } from "@/lib/search-params";
import { getCurrentUser } from "@/lib/session";
import { publicImageBaseUrl } from "@/lib/storage";

/**
 * Public agency page (prompt S23 decision 11): details, team and published listings. Shown only
 * while the agency has a published listing. No agency badge: verification is per person.
 */

type Params = Promise<{ slug: string }>;

const loadAgency = cache(async (slug: string) => {
  await connection();
  return getPublicAgency(getDb(), slug);
});

function pageOf(value: string | string[] | undefined): number {
  const n = Number(single(value));
  return Number.isInteger(n) && n > 1 && n < 10_000 ? n : 1;
}

const agencyPath = (slug: string, page = 1) => (page > 1 ? `/agencies/${slug}?page=${page}` : `/agencies/${slug}`);

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await loadAgency(slug);
  if (!result) return { title: "Agency not found", robots: { index: false } };
  const { agency } = result;
  const description = (agency.description ?? `Properties listed by ${agency.name} on VerifiedPropertiesKE.`).replace(/\s+/g, " ").trim().slice(0, 155);
  return {
    title: `${agency.name} — properties on VerifiedPropertiesKE`,
    description,
    alternates: { canonical: agencyPath(agency.slug) },
    ...(pageOf(query.page) > 1 ? { robots: { index: false } } : {}),
  };
}

function AgencyHeader({ agency }: { agency: PublicAgency }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-start">
      <Avatar name={agency.name} baseUrl={publicImageBaseUrl(agency.logoKey)} size="xl" className="shrink-0" />
      <div className="flex min-w-0 flex-col gap-2">
        <p className="text-micro font-semibold uppercase tracking-wide text-slate-600">Agency</p>
        <h1 className="text-display-sm">{agency.name}</h1>
        {agency.description && <p className="max-w-3xl whitespace-pre-line text-body text-slate-700">{agency.description}</p>}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {agency.websiteUrl && (
            <a
              href={agency.websiteUrl}
              target="_blank"
              rel="nofollow ugc noopener"
              className="inline-flex min-h-control items-center gap-1.5 text-small font-semibold text-emerald-700 underline underline-offset-4 hover:text-ink"
            >
              {new URL(agency.websiteUrl).hostname.replace(/^www\./, "")}
              <ExternalLink aria-hidden="true" className="size-4" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          {isGoogleMapsUrl(agency.officeMapUrl) && (
            <a
              href={agency.officeMapUrl}
              target="_blank"
              rel="nofollow ugc noopener noreferrer"
              className="inline-flex min-h-control items-center gap-1.5 text-small font-semibold text-emerald-700 underline underline-offset-4 hover:text-ink"
            >
              <MapPin aria-hidden="true" className="size-4" />
              Office on Google Maps
              <ExternalLink aria-hidden="true" className="size-4" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          )}
          <p className="text-micro text-slate-600">Details provided by the agency.</p>
        </div>
      </div>
    </header>
  );
}

/** Office buttons for signed-in viewers with a verified email only (decision 11). */
async function Office({ agencyId, agency }: { agencyId: string; agency: PublicAgency }) {
  const user = await getCurrentUser();
  const path = agencyPath(agency.slug);
  if (!user?.emailVerified) {
    return (
      <div className="flex flex-col gap-2 sm:max-w-sm">
        <Link href={signInPath(path)} className={buttonClasses({ size: "lg", className: "w-full" })}>
          Sign in to see contact details
        </Link>
        <p className="text-micro text-slate-600">It&apos;s free. You&apos;ll come straight back to this page.</p>
      </div>
    );
  }
  const office = await getAgencyOffice(getDb(), agencyId);
  if (!hasAnyContact(office)) return <p className="text-small text-slate-600">The agency hasn&apos;t added office contacts yet. Contact an agent from one of their listings.</p>;
  return (
    <ContactButtons
      className="sm:max-w-lg"
      contact={{ lister: NO_CONTACT_POINT, agency: office }}
      listerName={agency.name}
      listing={{ title: `${agency.name} listings`, url: new URL(path, getServerEnv().NEXT_PUBLIC_APP_URL).toString() }}
    />
  );
}

async function Team({ agencyId }: { agencyId: string }) {
  const team = await getPublicTeam(getDb(), agencyId);
  if (team.length === 0) return null;
  return (
    <section aria-labelledby="team-heading" className="flex flex-col gap-3">
      <h2 id="team-heading" className="text-title">
        Team
      </h2>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {team.map((member, i) => (
          <li key={`${member.displayName}-${i}`} className="flex items-center gap-3 rounded-sm border border-line bg-white p-3">
            <Avatar name={member.displayName} baseUrl={publicImageBaseUrl(member.avatarKey)} size="md" />
            <div className="flex min-w-0 flex-col">
              <p className="truncate text-small font-semibold text-ink">{member.displayName}</p>
              {member.verified ? (
                <VerifiedBadge className="self-start bg-transparent px-0 py-0 text-emerald-700" />
              ) : (
                <p className="text-micro text-slate-600">{LISTER_TYPE_LABELS[member.listerType]}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Listings({ agencyId, slug, page }: { agencyId: string; slug: string; page: number }) {
  const result = await agencyListings(getDb(), agencyId, page);
  const saveContext = await saveContextFor(
    result.items.map((card) => card.id),
    agencyPath(slug, result.page),
  );
  return (
    <section aria-labelledby="listings-heading" className="flex flex-col gap-4">
      <h2 id="listings-heading" className="text-title">
        Properties <span className="font-normal text-slate-600">({result.total})</span>
      </h2>
      <ul className={CARD_GRID}>
        {toCardData(result.items).map((listing, index) => (
          <li key={listing.id} className="flex">
            <PropertyCard listing={listing} save={saveProps(saveContext, listing.id)} eager={index === 0} />
          </li>
        ))}
      </ul>
      <Pagination hrefFor={(n) => agencyPath(slug, n)} page={result.page} pageCount={result.pageCount} />
    </section>
  );
}

async function AgencyPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const result = await loadAgency(slug);
  if (!result) notFound();
  const { agency, agencyId } = result;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <AgencyHeader agency={agency} />
        <Suspense fallback={<Skeleton className="h-control-lg w-full rounded-lg sm:max-w-sm" />}>
          <Office agencyId={agencyId} agency={agency} />
        </Suspense>
      </div>
      <Suspense fallback={<Skeleton className="h-20 w-full rounded-sm" />}>
        <Team agencyId={agencyId} />
      </Suspense>
      <Suspense fallback={<PropertyGridSkeleton count={6} />}>
        <Listings agencyId={agencyId} slug={agency.slug} page={pageOf(query.page)} />
      </Suspense>
    </div>
  );
}

export default function Page({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  return (
    <PageContainer className="pb-10 pt-6 md:pt-8">
      <Suspense
        fallback={
          <div className="flex flex-col gap-8" aria-busy="true">
            <span className="sr-only">Loading the agency</span>
            <Skeleton className="h-24 w-full rounded-sm" />
            <PropertyGridSkeleton count={6} />
          </div>
        }
      >
        <AgencyPage params={params} searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}
