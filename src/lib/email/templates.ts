import { BRAND } from "@/lib/brand";

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** First name only: emails carry minimal personal data. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

function detailRows(details: readonly (readonly [string, string])[]): string {
  if (details.length === 0) return "";
  const rows = details
    .map(
      ([label, value]) =>
        `<tr><td style="padding:6px 0;font-size:14px;color:#647168">${escapeHtml(label)}</td>` +
        `<td style="padding:6px 0;font-size:14px;font-weight:600;text-align:right">${escapeHtml(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border-top:1px solid #E1E7E2;border-bottom:1px solid #E1E7E2">${rows}</table>`;
}

function layout({ heading, body, actionLabel, url, footnote, details = [] }: {
  heading: string;
  body: string;
  actionLabel: string;
  url: string;
  footnote: string;
  details?: readonly (readonly [string, string])[];
}): string {
  const href = escapeHtml(url);
  return `<!doctype html>
<html lang="en">
  <body style="margin:0;background:#F7F8F5;font-family:Poppins,Arial,sans-serif;color:#17231D">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:1px solid #E1E7E2;border-radius:16px;padding:32px">
          <tr><td>
            <p style="margin:0 0 24px;font-weight:700;color:#087443">${BRAND.name}</p>
            <h1 style="margin:0 0 12px;font-size:22px;line-height:30px">${escapeHtml(heading)}</h1>
            <p style="margin:0 0 24px;font-size:15px;line-height:24px">${escapeHtml(body)}</p>
            ${detailRows(details)}
            <a href="${href}" style="display:inline-block;background:#14833B;color:#FFFFFF;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:12px">${escapeHtml(actionLabel)}</a>
            <p style="margin:24px 0 0;font-size:13px;line-height:20px;color:#647168">${escapeHtml(footnote)}</p>
            <p style="margin:12px 0 0;font-size:12px;line-height:18px;color:#647168;word-break:break-all">${href}</p>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export function verificationEmail(name: string, url: string): EmailContent {
  const greeting = `Hi ${firstName(name)},`;
  const body = `${greeting} confirm your email address to finish setting up your ${BRAND.name} account.`;
  const footnote = "This link expires in 1 hour. If you did not create an account, you can ignore this email.";
  return {
    subject: `Confirm your email for ${BRAND.name}`,
    html: layout({ heading: "Confirm your email", body, actionLabel: "Confirm email", url, footnote }),
    text: `${body}\n\nConfirm your email: ${url}\n\n${footnote}`,
  };
}

export function passwordResetEmail(name: string, url: string): EmailContent {
  const body = `Hi ${firstName(name)}, we received a request to reset your ${BRAND.name} password.`;
  const footnote =
    "This link expires in 1 hour and works once. If you did not ask for this, ignore this email: your password stays the same.";
  return {
    subject: `Reset your ${BRAND.name} password`,
    html: layout({ heading: "Reset your password", body, actionLabel: "Choose a new password", url, footnote }),
    text: `${body}\n\nChoose a new password: ${url}\n\n${footnote}`,
  };
}

export interface PaymentReceiptDetails {
  invoiceNumber: string;
  planName: string;
  /** "1 Nov 2026 – 1 Dec 2026", already formatted in Nairobi time. */
  period: string;
  /** "KSh 2,500" */
  amount: string;
  /** "M-Pesa QAB12CD34E" or "Visa •••• 4081" */
  paidWith: string;
  paidAt: string;
}

/** Sent once when a payment is confirmed (prompt S6 decision 5). First name only, no phone. */
export function paymentReceiptEmail(name: string, receipt: PaymentReceiptDetails, url: string): EmailContent {
  const body = `Hi ${firstName(name)}, thank you. We received your payment and your ${receipt.planName} plan is active.`;
  const details = [
    ["Invoice", receipt.invoiceNumber],
    ["Plan", receipt.planName],
    ["Period", receipt.period],
    ["Amount", receipt.amount],
    ["Paid with", receipt.paidWith],
    ["Paid on", receipt.paidAt],
  ] as const;
  const footnote = "Keep this email as your payment receipt. You can also view and print it from your billing page.";
  return {
    subject: `Your ${BRAND.name} receipt ${receipt.invoiceNumber}`,
    html: layout({ heading: "Payment received", body, actionLabel: "View receipt", url, footnote, details }),
    text: [body, "", ...details.map(([label, value]) => `${label}: ${value}`), "", `View receipt: ${url}`, "", footnote].join("\n"),
  };
}

export interface RenewalReminderDetails {
  planName: string;
  /** Which plan is ending (S13 decision 8). Defaults to a listing plan. */
  planKind?: "listing" | "verification";
  /** "5d": five days before the period end; "1d": the day before. */
  reminder: "5d" | "1d";
  /** "5 Dec 2026", already formatted in Nairobi time. */
  endsOn: string;
  /** "KSh 2,500" */
  price: string;
}

/** Renewal reminders 5 days and 1 day before a listing plan ends (prompt S9 decision 9). */
export function renewalReminderEmail(name: string, details: RenewalReminderDetails, url: string): EmailContent {
  const when = details.reminder === "1d" ? "tomorrow" : "in 5 days";
  const after =
    details.planKind === "verification"
      ? "Your \"Profile verified\" badge stays for 3 days after that, then it's hidden until you renew."
      : "Your listings stay live for 3 days after that, then they're paused until you renew.";
  const body = `Hi ${firstName(name)}, your ${details.planName} plan ends ${when}, on ${details.endsOn}. ${after}`;
  const rows = [
    ["Plan", details.planName],
    ["Ends on", details.endsOn],
    ["Renewal price", details.price],
  ] as const;
  const footnote = "Renewing adds 30 days from your current end date, so you don't lose any days by renewing early.";
  return {
    subject: `Your ${details.planName} plan ends ${when}`,
    html: layout({ heading: `Your plan ends ${when}`, body, actionLabel: "Renew plan", url, footnote, details: rows }),
    text: [body, "", ...rows.map(([label, value]) => `${label}: ${value}`), "", `Renew plan: ${url}`, "", footnote].join("\n"),
  };
}

/** The SMS version: no name, under 160 characters with a typical plan name and app URL. */
export function renewalReminderSms(details: Pick<RenewalReminderDetails, "planName" | "endsOn" | "planKind">, billingUrl: string): string {
  const keep = details.planKind === "verification" ? "your Profile verified badge" : "your listings live";
  return `${BRAND.name}: your ${details.planName} plan ends ${details.endsOn}. Renew to keep ${keep}: ${billingUrl}`;
}

/* Verification lifecycle (prompt S13 decision 9): first name, a date and a link; nothing else. */

export interface RereviewDetails {
  /** "30d" or "7d" before the review ends. */
  reminder: "30d" | "7d";
  /** "5 Dec 2026", already formatted in Nairobi time. */
  endsOn: string;
}

export function rereviewDueEmail(name: string, details: RereviewDetails, url: string): EmailContent {
  const when = details.reminder === "7d" ? "in 7 days" : "in 30 days";
  const body =
    `Hi ${firstName(name)}, your verification review ends ${when}, on ${details.endsOn}. ` +
    "Start your re-review now and upload fresh documents. It's included in your verification plan, and your badge stays while we check.";
  const rows = [["Review ends on", details.endsOn]] as const;
  const footnote = "Reviews are valid for 12 months. Without a new review, the \"Profile verified\" badge comes off when this one ends.";
  return {
    subject: `Your verification review ends ${when}`,
    html: layout({ heading: "Time for your re-review", body, actionLabel: "Start re-review", url, footnote, details: rows }),
    text: [body, "", ...rows.map(([label, value]) => `${label}: ${value}`), "", `Start re-review: ${url}`, "", footnote].join("\n"),
  };
}

export function rereviewDueSms(details: RereviewDetails, url: string): string {
  return `${BRAND.name}: your verification review ends ${details.endsOn}. Start your re-review to keep your badge: ${url}`;
}

export function verificationExpiredEmail(name: string, details: { endedOn: string }, url: string): EmailContent {
  const body =
    `Hi ${firstName(name)}, your verification review ended on ${details.endedOn}, so your "Profile verified" badge is no longer shown. ` +
    "Start a re-review to get it back.";
  const footnote = "If your verification plan is still paid up, the re-review is included.";
  return {
    subject: "Your verification review has ended",
    html: layout({ heading: "Verification review ended", body, actionLabel: "Start re-review", url, footnote }),
    text: [body, "", `Start re-review: ${url}`, "", footnote].join("\n"),
  };
}

export type VerificationEmailKind = "changes_requested" | "approved" | "rejected" | "rereview_rejected" | "suspended";

const VERIFICATION_EMAILS: Record<VerificationEmailKind, { subject: string; heading: string; lead: string; action: string }> = {
  changes_requested: {
    subject: "Your verification needs changes",
    heading: "Please update your documents",
    lead: "our team reviewed your verification and needs a few changes before approving it.",
    action: "Update documents",
  },
  approved: {
    subject: "Your profile is verified",
    heading: "Profile verified",
    lead: "your verification was approved. Your listings now show the \"Profile verified\" badge and rank first.",
    action: "View verification",
  },
  rejected: {
    subject: "Your verification was not approved",
    heading: "Verification not approved",
    lead: "our team couldn't approve your verification.",
    action: "View details",
  },
  rereview_rejected: {
    subject: "Your re-review was not approved",
    heading: "Re-review not approved",
    lead: "our team couldn't approve your re-review. Your current review stays valid until it ends, and you can start another re-review with updated documents.",
    action: "View details",
  },
  suspended: {
    subject: "Your verification is suspended",
    heading: "Verification suspended",
    lead: "your \"Profile verified\" badge has been suspended.",
    action: "View details",
  },
};

/**
 * Verification decisions (prompt S12 decision 11). First name and the admin's reason only; no
 * document details. The link goes to the signed-in verification page.
 */
export function verificationDecisionEmail(
  name: string,
  kind: VerificationEmailKind,
  details: { reason?: string | null; creditNote?: string | null },
  url: string,
): EmailContent {
  const copy = VERIFICATION_EMAILS[kind];
  const body = `Hi ${firstName(name)}, ${copy.lead}`;
  const rows = [
    ...(details.reason ? ([["Reason", details.reason]] as const) : []),
    ...(details.creditNote ? ([["Your fee", details.creditNote]] as const) : []),
  ];
  const footnote = "The badge says \"Profile verified\". It confirms the checks we made on your profile, not a licence or a guarantee about any property.";
  return {
    subject: copy.subject,
    html: layout({ heading: copy.heading, body, actionLabel: copy.action, url, footnote, details: rows }),
    text: [body, "", ...rows.map(([label, value]) => `${label}: ${value}`), "", `${copy.action}: ${url}`, "", footnote].join("\n"),
  };
}

/** A listing title for a subject line: one line, at most 60 characters. */
function subjectTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length > 60 ? `${flat.slice(0, 59).trimEnd()}…` : flat;
}

/**
 * New-message alert (prompt S16 decision 7). Never the message text, the sender's name or any
 * contact details: only the public listing title, the unread count and a link to sign in.
 */
export function messageAlertEmail(name: string, details: { listingTitle: string; unreadCount: number }, url: string): EmailContent {
  const count = Math.max(1, details.unreadCount);
  const messages = count === 1 ? "1 new message" : `${count} new messages`;
  const title = details.listingTitle.replace(/\s+/g, " ").trim();
  const body = `Hi ${firstName(name)}, you have ${messages} about ${title}. Sign in to read and reply.`;
  const footnote = `You're getting this because someone messaged you on ${BRAND.name}. Replies sent by email aren't delivered: reply on the site.`;
  return {
    subject: `New message about ${subjectTitle(title)}`,
    html: layout({ heading: "You have a new message", body, actionLabel: "Open conversation", url, footnote }),
    text: [body, "", `Open conversation: ${url}`, "", footnote].join("\n"),
  };
}

export interface ReviewQueueLine {
  count: number;
  /** "2 days", already formatted; null when the queue has nothing overdue. */
  oldest: string | null;
}

/** Moderators' daily digest (prompt S16 decision 6). Counts and ages only, no lister names. */
export function reviewDigestEmail(
  name: string,
  details: { listings: ReviewQueueLine; verifications: ReviewQueueLine; overdueHours: number },
  urls: { listings: string; verification: string },
): EmailContent {
  const total = details.listings.count + details.verifications.count;
  const items = total === 1 ? "1 item is" : `${total} items are`;
  const body = `Hi ${firstName(name)}, ${items} waiting for review longer than ${details.overdueHours} hours.`;
  const line = (q: ReviewQueueLine) => (q.oldest ? `${q.count} (oldest ${q.oldest})` : String(q.count));
  const rows = [
    [`Listings waiting over ${details.overdueHours} hours`, line(details.listings)],
    [`Verifications waiting over ${details.overdueHours} hours`, line(details.verifications)],
  ] as const;
  const footnote = `Verification reviews aim for 2 working days. You get this digest once a day while something is waiting.`;
  return {
    subject: total === 1 ? "1 item waiting for review" : `${total} items waiting for review`,
    html: layout({ heading: "Review queue reminder", body, actionLabel: "Open listings queue", url: urls.listings, footnote, details: rows }),
    text: [
      body,
      "",
      ...rows.map(([label, value]) => `${label}: ${value}`),
      "",
      `Listings queue: ${urls.listings}`,
      `Verification queue: ${urls.verification}`,
      "",
      footnote,
    ].join("\n"),
  };
}

/** "Acme Realty" with whitespace collapsed and cut for a subject line. */
function oneLine(value: string, max = 80): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Agency invite (prompt S23 decision 13). The inviter's public display name and the agency name
 * only; the link carries the token and works for the invited email address alone.
 */
export function agencyInviteEmail(details: { agencyName: string; inviterName: string; role: "admin" | "member"; expiresOn: string }, url: string): EmailContent {
  const agency = oneLine(details.agencyName);
  const inviter = oneLine(details.inviterName, 60);
  const as = details.role === "admin" ? "an admin" : "an agent";
  const body = `${inviter} invited you to join ${agency} on ${BRAND.name} as ${as}. Sign in or create an account with this email address, then accept the invite.`;
  const footnote = `This invite expires on ${details.expiresOn} and works only for this email address. Joining moves your listings into the agency; you'll see exactly what changes before you accept. If you weren't expecting it, ignore this email.`;
  return {
    subject: `Join ${agency} on ${BRAND.name}`,
    html: layout({ heading: `Join ${agency}`, body, actionLabel: "View invite", url, footnote }),
    text: [body, "", `View invite: ${url}`, "", footnote].join("\n"),
  };
}

/** Sent to an agent an admin removed (prompt S23 decision 7). */
export function agencyRemovedEmail(name: string, details: { agencyName: string; pausedListings: number }, url: string): EmailContent {
  const agency = oneLine(details.agencyName);
  const paused =
    details.pausedListings === 0
      ? "Your listings are yours and stay in your account."
      : `${details.pausedListings === 1 ? "1 listing is" : `${details.pausedListings} listings are`} paused until you have your own listing plan.`;
  const body = `Hi ${firstName(name)}, you're no longer part of ${agency} on ${BRAND.name}. ${paused}`;
  const footnote = "Your conversations with buyers stay in your Messages. Choose a listing plan to bring paused listings back.";
  return {
    subject: `You're no longer part of ${agency}`,
    html: layout({ heading: `You've left ${agency}`, body, actionLabel: "Choose a listing plan", url, footnote }),
    text: [body, "", `Choose a listing plan: ${url}`, "", footnote].join("\n"),
  };
}
