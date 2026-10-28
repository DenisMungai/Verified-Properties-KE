import { Resend } from "resend";
import type { EmailContent } from "./templates";

export interface EmailMessage extends EmailContent {
  to: string;
}

export type EmailTransport = (message: EmailMessage) => Promise<void>;

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email is not configured (RESEND_API_KEY, EMAIL_FROM).");
    this.name = "EmailNotConfiguredError";
  }
}

/** "wanjiru@example.com" -> "w•••@example.com" for logs. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "•••";
  return `${email[0]}•••${email.slice(at)}`;
}

/** The first http(s) link in a plain-text email, for the development console. */
function firstLink(text: string): string | undefined {
  return /https?:\/\/\S+/.exec(text)?.[0];
}

interface TransportConfig {
  resendApiKey?: string;
  emailFrom?: string;
  nodeEnv?: string;
  log?: (line: string) => void;
}

/**
 * Resend when configured. In development without it, the email is printed to the server console
 * (recipient masked, link shown) so sign-up can be tested. Production refuses to send.
 */
export function createTransport({
  resendApiKey,
  emailFrom,
  nodeEnv = process.env.NODE_ENV,
  log = console.info,
}: TransportConfig): EmailTransport {
  if (resendApiKey && emailFrom) {
    const resend = new Resend(resendApiKey);
    return async (message) => {
      const { error } = await resend.emails.send({
        from: emailFrom,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (error) throw new Error(`Resend rejected the email: ${error.name}`);
    };
  }
  if (nodeEnv === "production") {
    return async () => {
      throw new EmailNotConfiguredError();
    };
  }
  return async (message) => {
    log(
      [
        "",
        "──── Development email (RESEND_API_KEY not set) ────",
        `To:      ${maskEmail(message.to)}`,
        `Subject: ${message.subject}`,
        `Link:    ${firstLink(message.text) ?? "(none)"}`,
        "────────────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
  };
}
