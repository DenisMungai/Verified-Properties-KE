"use client";

import { useActionState, useState } from "react";
import { keepListingsAction } from "@/app/account/billing/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { ListingStatusBadge } from "@/components/listings/ListingStatusBadge";
import { Button } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

export interface KeepCandidateRow {
  id: string;
  title: string;
  location: string;
  status: "published" | "pending_review";
}

/**
 * After a downgrade: choose which listings stay live (prompt S6 decision 4). The newest `limit`
 * are pre-checked; the server re-checks the choice.
 */
export function KeepListingsForm({ listings, limit }: { listings: KeepCandidateRow[]; limit: number }) {
  const [state, action, pending] = useActionState(keepListingsAction, INITIAL_ACTION_STATE);
  const [kept, setKept] = useState(() => new Set(listings.slice(0, limit).map((listing) => listing.id)));
  const over = kept.size > limit;

  function toggle(id: string, checked: boolean) {
    setKept((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <FormAlert state={state} />
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Listings to keep live</legend>
        {listings.map((listing) => (
          <label
            key={listing.id}
            className="flex min-h-control cursor-pointer items-center gap-3 rounded-lg bg-canvas px-4 py-3 hover:bg-mint-50"
          >
            <input
              type="checkbox"
              name="keep"
              value={listing.id}
              checked={kept.has(listing.id)}
              onChange={(event) => toggle(listing.id, event.target.checked)}
              className="size-4 shrink-0 accent-emerald-600"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-small font-medium text-ink">{listing.title}</span>
              <span className="text-micro text-slate-600">{listing.location}</span>
            </span>
            <ListingStatusBadge status={listing.status} />
          </label>
        ))}
      </fieldset>
      <p aria-live="polite" className={over ? "text-small font-medium text-danger" : "text-small text-slate-700"}>
        {kept.size} of {limit} selected{over ? `. Untick ${kept.size - limit} to continue.` : ""}
      </p>
      <Button type="submit" size="lg" loading={pending} disabled={over} className="w-full sm:w-auto sm:self-start">
        Keep these live
      </Button>
    </form>
  );
}
