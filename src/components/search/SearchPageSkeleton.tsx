import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui";
import { PropertyGridSkeleton } from "./PropertyCard";

/** The /properties layout while the search streams in. */
export function SearchPageSkeleton() {
  return (
    <PageContainer className="pb-8 pt-4 md:pt-6">
      <div aria-busy="true" className="flex flex-col gap-4 md:gap-5">
        <span className="sr-only">Loading properties…</span>
        <Skeleton className="hidden h-4 w-40 md:block" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-32 w-full rounded-xl md:h-14" />
        <div className="grid gap-gutter md:grid-cols-[176px_minmax(0,1fr)]">
          <Skeleton className="hidden w-full rounded-lg md:block md:h-[32rem]" />
          <PropertyGridSkeleton />
        </div>
      </div>
    </PageContainer>
  );
}
