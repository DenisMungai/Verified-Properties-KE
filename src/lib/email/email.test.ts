import { describe, expect, it } from "vitest";
import { EmailNotConfiguredError, createTransport, maskEmail } from "./send";
import { firstName, passwordResetEmail, verificationEmail } from "./templates";

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
