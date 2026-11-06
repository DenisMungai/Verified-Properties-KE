"use client";

import { useState, useTransition } from "react";
import { startRereviewAction } from "@/app/account/verification/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { buttonClasses } from "@/components/ui";

/** Starts a free re-review (prompt S13 decision 4); the page refreshes into the upload state. */
export function StartRereviewButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-3">
      {error && <FormAlert state={{ formError: error }} />}
      <button
        type="button"
        disabled={pending}
        aria-disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const result = await startRereviewAction();
            if (!result.ok) setError(result.error);
          })
        }
        className={buttonClasses({ className: "w-full sm:w-auto sm:self-start" })}
      >
        {pending ? "Starting…" : "Start re-review"}
      </button>
    </div>
  );
}
