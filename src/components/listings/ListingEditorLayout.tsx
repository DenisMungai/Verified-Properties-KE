import type { ReactNode } from "react";
import { PageHeading } from "@/components/account/PageHeading";
import { Skeleton } from "@/components/ui/Skeleton";
import { ListingStepper, type ListingStepKey } from "./ListingStepper";

/**
 * Design "04 — Create Listing": heading, stepper card, then the step card beside a side panel
 * (stacked under it below lg).
 */
export function ListingEditorLayout({
  title,
  description,
  listingId,
  step,
  aside,
  notice,
  children,
}: {
  title: string;
  description: string;
  listingId?: string;
  step: ListingStepKey;
  aside: ReactNode;
  notice?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <PageHeading title={title} description={description} />
      <div className="flex flex-col gap-6">
        <ListingStepper listingId={listingId} current={step} />
        {notice}
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
          <section className="min-w-0 rounded-lg border border-line bg-white p-5 md:p-6">{children}</section>
          {aside}
        </div>
      </div>
    </>
  );
}

export function ListingEditorSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading listing</span>
      <Skeleton className="h-10 w-80 max-w-full" />
      <Skeleton className="h-control-lg rounded-lg" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
        <Skeleton className="h-96 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    </div>
  );
}
