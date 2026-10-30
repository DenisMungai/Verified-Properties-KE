"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Heart } from "lucide-react";
import { toggleSaveAction } from "@/app/properties/actions";
import { cn } from "@/lib/cn";

const base =
  "relative z-10 inline-flex size-control shrink-0 items-center justify-center rounded-pill border border-line bg-white text-ink shadow-card transition-colors hover:bg-mint-50";

export type SaveButtonProps =
  | { listingId: string; saved: boolean; refreshAfter?: boolean; signInHref?: never; className?: string }
  | { signInHref: string; listingId?: never; saved?: never; refreshAfter?: never; className?: string };

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <Heart
      aria-hidden="true"
      className={cn("size-5", filled ? "fill-emerald-600 text-emerald-600" : "text-ink")}
    />
  );
}

/** Shows the wanted state while the action is in flight, so the heart responds at once. */
function Toggle({ saved }: { saved: boolean }) {
  const { pending } = useFormStatus();
  const shown = pending ? !saved : saved;
  return (
    <button
      type="submit"
      aria-pressed={shown}
      aria-label={shown ? "Remove from saved" : "Save listing"}
      title={shown ? "Remove from saved" : "Save listing"}
      className={base}
    >
      <HeartIcon filled={shown} />
    </button>
  );
}

function SaveForm({ listingId, saved, refreshAfter, className }: { listingId: string; saved: boolean; refreshAfter?: boolean; className?: string }) {
  const [state, action] = useActionState(toggleSaveAction, { saved });
  return (
    <form action={action} className={className}>
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="saved" value={String(!state.saved)} />
      {refreshAfter && <input type="hidden" name="refresh" value="1" />}
      <Toggle saved={state.saved} />
      <span role="status" className="sr-only">
        {state.error ?? ""}
      </span>
    </form>
  );
}

/**
 * The heart (prompt S8 decision 6). Signed in: a Server Action form that works without
 * JavaScript. Signed out: a link to sign in that returns to this page; nothing is saved from a URL.
 */
export function SaveButton(props: SaveButtonProps) {
  if (props.signInHref !== undefined) {
    return (
      <Link href={props.signInHref} aria-label="Sign in to save this listing" title="Sign in to save" className={cn(base, props.className)}>
        <HeartIcon filled={false} />
      </Link>
    );
  }
  return <SaveForm listingId={props.listingId} saved={props.saved} refreshAfter={props.refreshAfter} className={props.className} />;
}
