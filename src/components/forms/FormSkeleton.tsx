import { Skeleton } from "@/components/ui/Skeleton";

/** Fallback while a form that depends on the request (search params, session) streams in. */
export function FormSkeleton({ fields = 2 }: { fields?: number }) {
  return (
    <div className="flex flex-col gap-5" aria-busy="true">
      <span className="sr-only">Loading form</span>
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-control w-full" />
        </div>
      ))}
      <Skeleton className="h-control-lg w-full" />
    </div>
  );
}
