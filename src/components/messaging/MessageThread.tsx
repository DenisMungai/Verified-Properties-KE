import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { dayLabel, formatNairobiTime } from "@/lib/messaging/format";
import { nairobiDay } from "@/lib/stats/engagement";
import { hasLink } from "@/lib/validation/messaging";

export const REMOVED_TEXT = "This message was removed by a moderator.";
export const LINK_WARNING = "Be careful with links. Never send a deposit or your M-Pesa PIN before viewing.";

export interface BubbleMessage {
  id: string;
  mine: boolean;
  /** Null when removed (participants never see removed text). */
  body: string | null;
  createdAt: Date;
}

/**
 * One message (prompt S15 UI "Messages"). The body is plain text rendered by React: never HTML,
 * never autolinked. `footer` holds the Report control or an admin note.
 */
export function MessageBubble({
  message,
  removed = message.body === null,
  highlight = false,
  footer,
}: {
  message: BubbleMessage;
  removed?: boolean;
  highlight?: boolean;
  footer?: ReactNode;
}) {
  const showWarning = !message.mine && !removed && message.body !== null && hasLink(message.body);
  return (
    <div className={cn("flex max-w-[85%] flex-col gap-1 sm:max-w-[70%]", message.mine ? "items-end self-end" : "items-start self-start")}>
      <div
        className={cn(
          "rounded-lg px-3 py-2",
          message.mine ? "bg-mint-50 text-ink" : "border border-line bg-white text-ink",
          highlight && "ring-2 ring-warning",
        )}
      >
        {removed && message.body === null ? (
          <p className="text-small italic text-slate-600">{REMOVED_TEXT}</p>
        ) : (
          <p className={cn("whitespace-pre-line break-words text-body", removed && "text-slate-600 line-through")}>{message.body}</p>
        )}
      </div>
      {showWarning && (
        <p className="flex items-start gap-1.5 text-micro text-warning-text">
          <TriangleAlert aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {LINK_WARNING}
        </p>
      )}
      <div className="flex items-center gap-3">
        <time dateTime={message.createdAt.toISOString()} className="text-micro text-slate-600">
          {formatNairobiTime(message.createdAt)}
        </time>
        {footer}
      </div>
    </div>
  );
}

/**
 * The thread, oldest first, with Nairobi day separators. The last item carries `id="latest"`
 * so the page can scroll to it.
 */
export function MessageThread<T extends BubbleMessage>({
  messages,
  now,
  renderMessage,
}: {
  messages: T[];
  now: Date;
  renderMessage: (message: T) => ReactNode;
}) {
  return (
    <ol aria-label="Messages" className="flex flex-col gap-3">
      {messages.map((message, index) => {
        const previous = messages[index - 1];
        const newDay = !previous || nairobiDay(previous.createdAt) !== nairobiDay(message.createdAt);
        return (
          <li key={message.id} id={index === messages.length - 1 ? "latest" : undefined} className="flex scroll-mb-28 flex-col gap-3">
            {newDay && <p className="self-center text-micro font-medium text-slate-600">{dayLabel(message.createdAt, now)}</p>}
            {renderMessage(message)}
          </li>
        );
      })}
    </ol>
  );
}
