import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui";
import { PropertyGridSkeleton } from "./PropertyCard";

/** The /properties layout while the search streams in. */
export function SearchPageSkeleton() {
  return (
    <PageContainer className="pb-8 pt-6">
      <div aria-busy="true" className="flex flex-col gap-5">
        <span className="sr-only">Loading properties…</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-80 max-w-full" />
        <Skeleton className="h-14 w-full rounded-xl" />
        <div className="grid gap-gutter md:grid-cols-[176px_minmax(0,1fr)]">
          <Skeleton className="h-control w-full rounded-lg md:h-[32rem]" />
          <PropertyGridSkeleton />
        </div>
      </div>
    </PageContainer>
  );
}
