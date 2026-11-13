import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui";
import { PropertyGridSkeleton } from "./PropertyCard";

/** The /properties layout while the search streams in. */
export function SearchPageSkeleton() {
  return (
    // Same window-fitting shell as the page from md, so the footer doesn't flash in and out.
    <PageContainer className="flex flex-col pb-8 pt-4 md:min-h-0 md:flex-1 md:pb-4 md:pt-6">
      <div aria-busy="true" className="flex flex-col gap-4 md:min-h-0 md:flex-1 md:gap-5">
        <span className="sr-only">Loading properties…</span>
        <Skeleton className="hidden h-4 w-40 md:block [@media(max-height:820px)]:!hidden" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-32 w-full rounded-xl md:h-14" />
        <div className="grid gap-gutter md:min-h-0 md:flex-1 md:grid-cols-[176px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)]">
          <Skeleton className="hidden w-full rounded-lg md:block md:h-[32rem] md:max-h-full" />
          <div data-results-scroll className="md:min-h-0 md:overflow-hidden">
            <PropertyGridSkeleton />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
