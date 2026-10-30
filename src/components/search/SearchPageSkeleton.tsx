import { PageContainer } from "@/components/layout/PageContainer";
import { Skeleton } from "@/components/ui";
import { PropertyGridSkeleton } from "./PropertyCard";

/** The /properties layout while the search streams in. */
export function SearchPageSkeleton() {
  return (
    <PageContainer className="py-8 lg:py-10">
      <div aria-busy="true" className="flex flex-col gap-6">
        <span className="sr-only">Loading properties…</span>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-80 max-w-full" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="grid gap-6 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:gap-8">
          <Skeleton className="h-control w-full rounded-md lg:h-[36rem] lg:rounded-xl" />
          <PropertyGridSkeleton />
        </div>
      </div>
    </PageContainer>
  );
}
