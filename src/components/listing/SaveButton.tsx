"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Heart } from "lucide-react";
import { toggleSaveAction } from "@/app/properties/actions";
import { cn } from "@/lib/cn";

const base =
  "relative z-10 inline-flex shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-mint-50";

/**
 * `md`: 44px bordered circle (detail page). `sm`: 32px borderless circle on cards, with an
 * invisible 44px hit area so the touch target stays large.
 */
const sizes = {
  md: "size-control border border-line bg-white",
  sm:
    "size-8 bg-white/90 after:absolute after:left-1/2 after:top-1/2 after:size-control " +
    "after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']",
} as const;

type SaveButtonSize = keyof typeof sizes;

export type SaveButtonProps =
  | { listingId: string; saved: boolean; refreshAfter?: boolean; signInHref?: never; size?: SaveButtonSize; className?: string }
  | { signInHref: string; listingId?: never; saved?: never; refreshAfter?: never; size?: SaveButtonSize; className?: string };

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <Heart
      aria-hidden="true"
      className={cn("size-4", filled ? "fill-emerald-600 text-emerald-600" : "text-ink")}
    />
  );
}

/** Shows the wanted state while the action is in flight, so the heart responds at once. */
function Toggle({ saved, size }: { saved: boolean; size: SaveButtonSize }) {
  const { pending } = useFormStatus();
  const shown = pending ? !saved : saved;
  return (
    <button
      type="submit"
      aria-pressed={shown}
      aria-label={shown ? "Remove from saved" : "Save listing"}
      title={shown ? "Remove from saved" : "Save listing"}
      className={cn(base, sizes[size])}
    >
      <HeartIcon filled={shown} />
    </button>
  );
}

function SaveForm({
  listingId,
  saved,
  refreshAfter,
  size,
  className,
}: {
  listingId: string;
  saved: boolean;
  refreshAfter?: boolean;
  size: SaveButtonSize;
  className?: string;
}) {
  const [state, action] = useActionState(toggleSaveAction, { saved });
  return (
    <form action={action} className={className}>
      <input type="hidden" name="listingId" value={listingId} />
      <input type="hidden" name="saved" value={String(!state.saved)} />
      {refreshAfter && <input type="hidden" name="refresh" value="1" />}
      <Toggle saved={state.saved} size={size} />
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
      <Link href={props.signInHref} aria-label="Sign in to save this listing" title="Sign in to save" className={cn(base, sizes[props.size ?? "md"], props.className)}>
        <HeartIcon filled={false} />
      </Link>
    );
  }
  return (
    <SaveForm
      listingId={props.listingId}
      saved={props.saved}
      refreshAfter={props.refreshAfter}
      size={props.size ?? "md"}
      className={props.className}
    />
  );
}
