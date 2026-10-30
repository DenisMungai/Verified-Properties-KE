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
