import { describe, expect, it } from "vitest";
import { EmailNotConfiguredError, createTransport, maskEmail } from "./send";
import { agencyInviteEmail, agencyRemovedEmail, firstName, passwordResetEmail, paymentReceiptEmail, verificationEmail } from "./templates";

const url = "http://localhost:3000/api/auth/verify-email?token=abc&callbackURL=%2Faccount";

describe("templates", () => {
  it("uses the first name only and includes the link in html and text", () => {
    const email = verificationEmail("Wanjiru Kamau", url);
    expect(email.text).toContain("Hi Wanjiru,");
    expect(email.text).not.toContain("Kamau");
    expect(email.text).toContain(url);
    expect(email.html).toContain(url.replaceAll("&", "&amp;"));
  });

  it("escapes HTML in names", () => {
    const email = passwordResetEmail("<script>x</script>", url);
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
  });

  it("lists the receipt details in html and text, escaped", () => {
    const email = paymentReceiptEmail(
      "Wanjiru Kamau",
      {
        invoiceNumber: "VPK0000042",
        planName: "Pro <b>",
        period: "1 Nov 2026 – 1 Dec 2026",
        amount: "KSh 2,500",
        paidWith: "M-Pesa QAB12CD34E",
        paidAt: "1 Nov 2026, 09:00",
      },
      "http://localhost:3000/account/billing/receipts/VPK0000042",
    );
    expect(email.subject).toContain("VPK0000042");
    expect(email.text).toContain("Hi Wanjiru,");
    expect(email.text).not.toContain("Kamau");
    expect(email.text).toContain("Amount: KSh 2,500");
    expect(email.text).toContain("Paid with: M-Pesa QAB12CD34E");
    expect(email.html).toContain("Pro &lt;b&gt;");
    expect(email.html).not.toContain("Pro <b>");
  });

  it("falls back when the name is blank", () => {
    expect(firstName("   ")).toBe("there");
  });
});

describe("maskEmail", () => {
  it("keeps the first letter and domain", () => {
    expect(maskEmail("wanjiru@example.com")).toBe("w•••@example.com");
    expect(maskEmail("nope")).toBe("•••");
  });
});

describe("createTransport", () => {
  const message = { to: "wanjiru@example.com", ...verificationEmail("Wanjiru", url) };

  it("prints a masked development email when Resend is not configured", async () => {
    const lines: string[] = [];
    const send = createTransport({ nodeEnv: "development", log: (line) => lines.push(line) });
    await send(message);
    const output = lines.join("\n");
    expect(output).toContain("w•••@example.com");
    expect(output).not.toContain("wanjiru@example.com");
    expect(output).toContain(url);
  });

  it("refuses to send in production without Resend", async () => {
    const send = createTransport({ nodeEnv: "production" });
    await expect(send(message)).rejects.toBeInstanceOf(EmailNotConfiguredError);
  });
});

describe("agency emails (prompt S23)", () => {
  const link = "https://app.example/account/agency/invites/tok";

  it("names the agency and inviter, escapes HTML and carries the link", () => {
    const email = agencyInviteEmail({ agencyName: "Acme <b>Realty</b>", inviterName: "Wanjiru Kamau", role: "member", expiresOn: "19 Nov 2026" }, link);
    expect(email.subject).toBe("Join Acme <b>Realty</b> on VerifiedPropertiesKE");
    expect(email.html).toContain("Acme &lt;b&gt;Realty&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Realty</b>");
    expect(email.text).toContain("as an agent");
    expect(email.text).toContain("19 Nov 2026");
    expect(email.text).toContain(link);
  });

  it("says when someone is invited as an admin", () => {
    expect(agencyInviteEmail({ agencyName: "Acme", inviterName: "W", role: "admin", expiresOn: "x" }, link).text).toContain("as an admin");
  });

  it("tells a removed agent how many listings were paused, first name only", () => {
    const email = agencyRemovedEmail("Brian Otieno", { agencyName: "Acme", pausedListings: 2 }, "https://app.example/account/billing/checkout");
    expect(email.text).toContain("Hi Brian,");
    expect(email.text).not.toContain("Otieno");
    expect(email.text).toContain("2 listings are paused");
    expect(agencyRemovedEmail("B", { agencyName: "Acme", pausedListings: 0 }, "u").text).toContain("stay in your account");
  });
});
