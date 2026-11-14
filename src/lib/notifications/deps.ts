import type { DbExecutor } from "@/db/executor";
import type { EmailTransport } from "@/lib/email/send";

/** What notification senders need: the database, the clock, email and the link base. */
export interface NotificationDeps {
  db: DbExecutor;
  now: () => Date;
  email: EmailTransport;
  /** Absolute base for links in emails, without a trailing slash. */
  appUrl: string;
}
