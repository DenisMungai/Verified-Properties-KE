"use client";

import { RotateCcw } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button, EmptyState } from "@/components/ui";

/** The listing failed to load (usually the database). Nothing about the error is shown. */
export default function ListingError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <PageContainer className="py-12">
      <EmptyState
        title="We couldn't load this listing"
        description="Something went wrong on our side. Please try again in a moment."
        action={
          <Button variant="secondary" onClick={() => retry()}>
            <RotateCcw aria-hidden="true" className="size-4" />
            Try again
          </Button>
        }
      />
    </PageContainer>
  );
}
