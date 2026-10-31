"use client";

import { RotateCcw } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button, EmptyState } from "@/components/ui";

/**
 * Search failed (usually the database). Nothing about the error is shown to the visitor.
 * `retry` refetches the segment (Next 16.2+), which `reset` would not.
 */
export default function PropertiesError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <PageContainer className="py-10">
      <EmptyState
        title="We couldn't load properties"
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
