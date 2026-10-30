import { maskPhone } from "@/lib/kenya";

/**
 * Optional SMS through Africa's Talking (plan v2.0 §3; prompt S9 decision 10). Mirrors the email
 * transport: the real API when configured, the console in development, and "not configured" in
 * production so the caller can mark the reminder skipped. Logs never carry the API key, the
 * message body or an unmasked phone.
 */

export interface SmsMessage {
  /** E.164, e.g. +254712345678. */
  to: string;
  text: string;
}

export type SmsResult = { status: "sent" } | { status: "not_configured" } | { status: "failed"; error: string };

export type SmsTransport = (message: SmsMessage) => Promise<SmsResult>;

/** Africa's Talking per-recipient codes that mean accepted: Processed, Sent, Queued. */
const AT_ACCEPTED_CODES = new Set([100, 101, 102]);

export function africasTalkingUrl(username: string): string {
  const host = username === "sandbox" ? "api.sandbox.africastalking.com" : "api.africastalking.com";
  return `https://${host}/version1/messaging`;
}

interface AtResponse {
  SMSMessageData?: { Recipients?: { statusCode?: number; status?: string }[] };
}

interface SmsConfig {
  username?: string;
  apiKey?: string;
  senderId?: string;
  nodeEnv?: string;
  fetchImpl?: typeof fetch;
  log?: (line: string) => void;
}

export function createSmsTransport({
  username,
  apiKey,
  senderId,
  nodeEnv = process.env.NODE_ENV,
  fetchImpl = fetch,
  log = console.info,
}: SmsConfig): SmsTransport {
  if (username && apiKey) {
    const url = africasTalkingUrl(username);
    return async ({ to, text }) => {
      const body = new URLSearchParams({ username, to, message: text, bulkSMSMode: "1" });
      if (senderId) body.set("from", senderId);
      try {
        const response = await fetchImpl(url, {
          method: "POST",
          headers: { apikey: apiKey, Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
          body,
          signal: AbortSignal.timeout(10_000),
        });
        if (response.status !== 201 && response.status !== 200) return { status: "failed", error: `http_${response.status}` };
        const data = (await response.json()) as AtResponse;
        const recipient = data.SMSMessageData?.Recipients?.[0];
        if (recipient?.statusCode !== undefined && AT_ACCEPTED_CODES.has(recipient.statusCode)) return { status: "sent" };
        return { status: "failed", error: `at_${recipient?.statusCode ?? "no_recipient"}` };
      } catch (error) {
        return { status: "failed", error: error instanceof Error ? error.name : "unknown" };
      }
    };
  }
  if (nodeEnv === "production") return async () => ({ status: "not_configured" });
  return async ({ to, text }) => {
    log(
      [
        "",
        "──── Development SMS (AT_USERNAME / AT_API_KEY not set) ────",
        `To:   ${maskPhone(to)}`,
        `Text: ${text}`,
        "────────────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { status: "sent" };
  };
}
