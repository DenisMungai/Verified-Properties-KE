import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { DataRequestForm } from "@/components/legal/DataRequestForm";
import { TextLink } from "@/components/legal/LegalPage";
import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton, buttonClasses } from "@/components/ui";
import { getDb } from "@/db";
import { listOwnDataRequests, type OwnDataRequest } from "@/db/queries/data-requests";
import { formatNairobiDate } from "@/lib/format";
import {
  BILLING_RESPONSE_WORKING_DAYS,
  DATA_REQUEST_KIND_LABELS,
  DATA_REQUEST_PATH,
  LEGAL,
  PRIVACY_RESPONSE_DAYS,
  requestReference,
} from "@/lib/legal";
import { getCurrentUser } from "@/lib/session";

export const metadata: Metadata = {
  title: "Privacy and billing requests",
  description: "Ask for a copy of your data, a correction or deletion, object to a use, or raise a billing or refund question.",
};

function StatusChip({ status }: { status: OwnDataRequest["status"] }) {
  return (
    <span
      className={
        status === "open"
          ? "rounded-full bg-mint-50 px-3 py-1 text-micro font-semibold text-emerald-700"
          : "rounded-full border border-line px-3 py-1 text-micro font-semibold text-slate-600"
      }
    >
      {status === "open" ? "Open" : "Closed"}
    </span>
  );
}

function OwnRequests({ requests }: { requests: OwnDataRequest[] }) {
  if (requests.length === 0) return null;
  return (
    <section aria-labelledby="your-requests" className="flex flex-col gap-3">
      <h2 id="your-requests" className="text-title">
        Your requests
      </h2>
      <ul className="flex flex-col gap-2">
        {requests.map((request) => (
          <li key={request.id} className="flex flex-col gap-2 rounded-sm border border-line bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-small font-semibold text-ink">
                {DATA_REQUEST_KIND_LABELS[request.kind].label}{" "}
                <span className="font-normal text-slate-600">
                  · {requestReference(request.id)} · {formatNairobiDate(request.createdAt)}
                </span>
              </p>
              <StatusChip status={request.status} />
            </div>
            <p className="whitespace-pre-line break-words text-small text-slate-700">{request.details}</p>
            {request.resolutionNote && (
              <p className="whitespace-pre-line break-words rounded-md bg-mint-50 p-3 text-small text-ink">
                <span className="font-semibold">Our reply{request.closedAt ? ` (${formatNairobiDate(request.closedAt)})` : ""}:</span>{" "}
                {request.resolutionNote}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The form for signed-in, verified users; a sign-in panel for everyone else. Reads the session. */
async function RequestArea() {
  const user = await getCurrentUser();
  if (!user?.emailVerified) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-lg bg-mint-50 p-5">
        <p className="text-small text-ink">
          Sign in to make a request. Because you&apos;re signed in, we know the request is yours, so we won&apos;t ask for ID.
          {LEGAL.contactEmail ? (
            <>
              {" "}
              Can&apos;t sign in? Email{" "}
              <a href={`mailto:${LEGAL.contactEmail}`} className="font-medium text-emerald-700 underline underline-offset-4">
                {LEGAL.contactEmail}
              </a>
              .
            </>
          ) : null}
        </p>
        <Link href={`/sign-in?next=${encodeURIComponent(DATA_REQUEST_PATH)}`} className={buttonClasses({ variant: "secondary" })}>
          Sign in
        </Link>
      </div>
    );
  }
  const requests = await listOwnDataRequests(getDb(), user.id);
  return (
    <>
      <DataRequestForm />
      <OwnRequests requests={requests} />
    </>
  );
}

/** Data-request route (plan v2.0 §12; prompt S20 decision 7). */
export default function DataRequestPage() {
  return (
    <PageContainer width="text" className="pb-8 pt-6">
      <article className="mx-auto flex max-w-prose flex-col gap-8">
        <header className="flex flex-col gap-3">
          <p className="text-micro font-semibold uppercase tracking-wide text-emerald-700">Legal</p>
          <h1 className="text-display-sm">Privacy and billing requests</h1>
          <p className="text-body text-slate-700">
            Ask for a copy of your data, have it corrected or deleted, object to how it&apos;s used, or raise a billing or refund
            question. We reply to privacy requests within {PRIVACY_RESPONSE_DAYS} days and billing questions within{" "}
            {BILLING_RESPONSE_WORKING_DAYS} working days. Read more in our <TextLink href="/privacy">privacy notice</TextLink> and{" "}
            <TextLink href="/subscription-policy">subscription and refund policy</TextLink>.
          </p>
        </header>
        <Suspense fallback={<Skeleton className="h-96" />}>
          <RequestArea />
        </Suspense>
      </article>
    </PageContainer>
  );
}
