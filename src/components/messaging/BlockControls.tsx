"use client";

import { useActionState } from "react";
import { MoreHorizontal } from "lucide-react";
import { blockUserAction, unblockUserAction } from "@/app/account/messages/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { Button } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";

/** Unblock button (used in the "More" menu and in the blocked note under the thread). */
export function UnblockButton({ conversationId, variant = "secondary" }: { conversationId: string; variant?: "secondary" | "ghost" }) {
  const [state, action, pending] = useActionState(unblockUserAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <FormAlert state={state} />
      <Button type="submit" variant={variant} loading={pending} className="self-start">
        Unblock
      </Button>
    </form>
  );
}

function BlockButton({ conversationId, name }: { conversationId: string; name: string }) {
  const [state, action, pending] = useActionState(blockUserAction, INITIAL_ACTION_STATE);
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <p className="text-small text-slate-600">Neither of you will be able to send messages, about this or any other listing. You can unblock later.</p>
      <FormAlert state={state} />
      <Button type="submit" variant="danger" loading={pending} className="self-start">
        Block {name}
      </Button>
    </form>
  );
}

/**
 * The thread's "More" disclosure (prompt S15 decision 11). A <details> element rather than the
 * Popover API, which the user's phone browser lacks.
 */
export function BlockControls({ conversationId, name, blockedByMe }: { conversationId: string; name: string; blockedByMe: boolean }) {
  return (
    <details className="group relative">
      <summary className="inline-flex size-control cursor-pointer list-none items-center justify-center rounded-md text-slate-700 hover:bg-mint-50 hover:text-ink [&::-webkit-details-marker]:hidden">
        <MoreHorizontal aria-hidden="true" className="size-5" />
        <span className="sr-only">More actions</span>
      </summary>
      <div className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-4">
        {blockedByMe ? <UnblockButton conversationId={conversationId} /> : <BlockButton conversationId={conversationId} name={name} />}
      </div>
    </details>
  );
}
