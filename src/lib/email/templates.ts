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

function layout({ heading, body, actionLabel, url, footnote }: {
  heading: string;
  body: string;
  actionLabel: string;
  url: string;
  footnote: string;
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
