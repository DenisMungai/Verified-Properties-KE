import { z } from "zod";
import { REPORT_DETAILS_MAX } from "./engagement";

/**
 * In-app messaging input (prompt S15 decisions 8 and 12). Bodies are stored trimmed as plain text
 * and rendered by React as text: never HTML, never autolinked.
 */

export const MESSAGE_MAX = 2000;
export const MAX_LINKS = 2;
/** The same text as your own last message within this window is treated as a double send. */
export const DUPLICATE_WINDOW_MS = 60_000;

/**
 * Links as a scammer would paste them: `http(s)://…`, `www.…`, or a bare domain with a common
 * TLD (`pay-deposit.co.ke/x`). A domain inside an email address is not a link.
 */
const LINK =
  /(?:https?:\/\/|www\.)[^\s]+|(?<![@\w.-])(?:[a-z0-9-]+\.)+(?:com|net|org|ke|info|io|biz|xyz|me|link|ly|app|site|online|top|shop|club|live)\b(?:\/[^\s]*)?/gi;

export function countLinks(text: string): number {
  return text.match(LINK)?.length ?? 0;
}

export function hasLink(text: string): boolean {
  return countLinks(text) > 0;
}

export const messageSchema = z
  .string({ error: "Write a message." })
  .trim()
  .min(1, { error: "Write a message." })
  .max(MESSAGE_MAX, { error: `Use at most ${MESSAGE_MAX} characters.` })
  .refine((body) => countLinks(body) <= MAX_LINKS, { error: `Messages can include at most ${MAX_LINKS} links.` });

export const MESSAGE_REPORT_REASONS = ["scam", "spam", "offensive", "other"] as const;
export type MessageReportReason = (typeof MESSAGE_REPORT_REASONS)[number];

export const MESSAGE_REPORT_REASON_LABELS: Record<MessageReportReason, string> = {
  scam: "Scam or fraud",
  spam: "Spam",
  offensive: "Offensive or abusive",
  other: "Other",
};

export const messageReportSchema = z.object({
  reason: z.enum(MESSAGE_REPORT_REASONS, { error: "Choose a reason." }),
  details: z
    .string()
    .trim()
    .max(REPORT_DETAILS_MAX, { error: `Use at most ${REPORT_DETAILS_MAX} characters.` })
    .transform((value) => (value === "" ? null : value)),
  block: z.boolean(),
});

export type MessageReportInput = z.output<typeof messageReportSchema>;
