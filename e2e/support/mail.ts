/**
 * Development emails from the e2e server's log (prompt S22 decision 3). The dev transport prints
 * each email as a block with a masked recipient and the first link. Tests run one at a time, so
 * "the first matching email after this byte offset" is the one the action just sent.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { SERVER_LOG } from "./env";

export function logOffset(): number {
  return existsSync(SERVER_LOG) ? statSync(SERVER_LOG).size : 0;
}

interface DevEmail {
  to: string;
  subject: string;
  link: string | null;
}

function emailsSince(offset: number): DevEmail[] {
  // Bytes, not characters: the email box is drawn with multibyte characters.
  const text = readFileSync(SERVER_LOG).subarray(offset).toString("utf8");
  const blocks = text.split("──── Development email").slice(1);
  return blocks.map((block) => ({
    to: /To:\s+(\S+)/.exec(block)?.[1] ?? "",
    subject: /Subject:\s+(.+)/.exec(block)?.[1]?.trim() ?? "",
    link: /Link:\s+(https?:\/\/\S+)/.exec(block)?.[1] ?? null,
  }));
}

/** "buyer@example.test" -> "b•••@example.test", as the dev log prints it. */
function masked(email: string): string {
  const at = email.lastIndexOf("@");
  return `${email[0]}•••${email.slice(at)}`;
}

export async function waitForEmailLink(
  offset: number,
  { to, subject }: { to: string; subject: RegExp },
  timeoutMs = 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = emailsSince(offset).find((e) => e.to === masked(to) && subject.test(e.subject) && e.link);
    if (match?.link) return match.link;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`[e2e] no email "${subject}" to ${masked(to)} in the server log within ${timeoutMs / 1000}s`);
}
