"use client";

import { useState } from "react";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Design "04 — Create Listing" footer: Save draft (secondary) left, Continue (primary) right.
 * On mobile both are full width with Continue on top. Both submit the form with an `intent`.
 */
export function StepFormFooter({ pending, continueLabel = "Continue" }: { pending: boolean; continueLabel?: string }) {
  const [clicked, setClicked] = useState<"draft" | "continue">("continue");
  return (
    <div className="flex flex-col-reverse gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
      <Button
        type="submit"
        name="intent"
        value="draft"
        variant="secondary"
        size="lg"
        loading={pending && clicked === "draft"}
        disabled={pending}
        onClick={() => setClicked("draft")}
        className="w-full sm:w-auto"
      >
        Save draft
      </Button>
      <Button
        type="submit"
        name="intent"
        value="continue"
        size="lg"
        loading={pending && clicked === "continue"}
        disabled={pending}
        onClick={() => setClicked("continue")}
        className="w-full sm:w-auto"
      >
        {continueLabel}
        <ArrowRight aria-hidden="true" className="size-4" />
      </Button>
    </div>
  );
}
