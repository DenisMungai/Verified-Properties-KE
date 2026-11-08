"use client";

import { useActionState, useEffect, useRef } from "react";
import { SendHorizontal } from "lucide-react";
import { sendMessageAction } from "@/app/account/messages/actions";
import { FormAlert } from "@/components/forms/FormAlert";
import { Button, Textarea } from "@/components/ui";
import { INITIAL_ACTION_STATE } from "@/lib/action-state";
import { MESSAGE_MAX } from "@/lib/validation/messaging";

/**
 * Reply box (prompt S15 UI "Reply box"). Below lg it is a fixed bottom bar (`data-mobile-bar`
 * pads the page beneath it) with a one-line box; from lg it sits under the thread. Enter adds a
 * newline; the button sends. After a send the box clears; the server re-renders the thread.
 */
export function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(sendMessageAction, INITIAL_ACTION_STATE);
  const formRef = useRef<HTMLFormElement>(null);
  const fieldError = state.fieldErrors?.body;

  useEffect(() => {
    if (state.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} noValidate className="flex flex-col gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <FormAlert state={state.ok ? {} : state} />
      {fieldError && (
        <p id="reply-error" role="alert" className="text-small font-medium text-danger">
          {fieldError}
        </p>
      )}
      <div
        data-mobile-bar
        className="fixed inset-x-0 bottom-0 z-30 flex h-[var(--vp-mobile-bar-height)] items-center gap-2 border-t border-line bg-white px-4 lg:static lg:h-auto lg:items-end lg:gap-3 lg:border-0 lg:bg-transparent lg:px-0"
      >
        <label htmlFor="reply-body" className="sr-only">
          Reply
        </label>
        <Textarea
          id="reply-body"
          name="body"
          rows={3}
          maxLength={MESSAGE_MAX}
          required
          placeholder="Write a message…"
          defaultValue={state.ok ? "" : (state.values?.body ?? "")}
          aria-invalid={fieldError ? true : undefined}
          aria-describedby={fieldError ? "reply-error" : undefined}
          className="h-control min-h-0 flex-1 resize-none py-2.5 lg:h-auto lg:resize-y lg:py-3"
        />
        <Button type="submit" loading={pending} className="shrink-0 px-4 lg:px-5">
          <SendHorizontal aria-hidden="true" className="size-4" />
          <span className="sr-only lg:not-sr-only">Send</span>
        </Button>
      </div>
    </form>
  );
}
