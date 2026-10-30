import { describe, expect, it } from "vitest";
import { renewalReminderEmail, renewalReminderSms } from "@/lib/email/templates";
import { africasTalkingUrl, createSmsTransport } from "./send";

const message = { to: "+254712345678", text: "VerifiedPropertiesKE: your Starter plan ends 5 Dec 2026." };

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe("createSmsTransport", () => {
  it("uses the sandbox host for the sandbox username", () => {
    expect(africasTalkingUrl("sandbox")).toBe("https://api.sandbox.africastalking.com/version1/messaging");
    expect(africasTalkingUrl("vpk")).toBe("https://api.africastalking.com/version1/messaging");
  });

  it("posts a form with the api key header and reads the recipient status", async () => {
    const fetch = fakeFetch(201, { SMSMessageData: { Recipients: [{ statusCode: 101, status: "Success" }] } });
    const send = createSmsTransport({ username: "sandbox", apiKey: "at_key", senderId: "VPK", fetchImpl: fetch.impl });
    expect(await send(message)).toEqual({ status: "sent" });
    const { url, init } = fetch.calls[0];
    expect(url).toContain("sandbox");
    expect((init.headers as Record<string, string>).apikey).toBe("at_key");
    const form = init.body as URLSearchParams;
    expect(form.get("username")).toBe("sandbox");
    expect(form.get("to")).toBe("+254712345678");
    expect(form.get("from")).toBe("VPK");
  });

  it("reports a rejected recipient or HTTP error as failed, without the message", async () => {
    const rejected = fakeFetch(201, { SMSMessageData: { Recipients: [{ statusCode: 403, status: "InvalidPhoneNumber" }] } });
    expect(await createSmsTransport({ username: "u", apiKey: "k", fetchImpl: rejected.impl })(message)).toEqual({ status: "failed", error: "at_403" });
    const down = fakeFetch(401, {});
    expect(await createSmsTransport({ username: "u", apiKey: "k", fetchImpl: down.impl })(message)).toEqual({ status: "failed", error: "http_401" });
  });

  it("prints a masked phone in development and is not configured in production", async () => {
    const lines: string[] = [];
    const dev = createSmsTransport({ nodeEnv: "development", log: (line) => lines.push(line) });
    expect(await dev(message)).toEqual({ status: "sent" });
    expect(lines.join("\n")).not.toContain("712345678");
    expect(await createSmsTransport({ nodeEnv: "production" })(message)).toEqual({ status: "not_configured" });
  });
});

describe("renewal reminder templates", () => {
  const details = { planName: "Starter", reminder: "5d" as const, endsOn: "10 Dec 2026", price: "KSh 1,000" };

  it("names the end date and links to renew, first name only", () => {
    const email = renewalReminderEmail("Wanjiru Kamau", details, "https://app.example/account/billing/checkout?plan=starter");
    expect(email.subject).toBe("Your Starter plan ends in 5 days");
    expect(email.text).toContain("Hi Wanjiru,");
    expect(email.text).not.toContain("Kamau");
    expect(email.text).toContain("10 Dec 2026");
    expect(email.text).toContain("https://app.example/account/billing/checkout?plan=starter");
    expect(email.html).toContain("Renew plan");
    expect(renewalReminderEmail("A", { ...details, reminder: "1d" }, "https://x").subject).toBe("Your Starter plan ends tomorrow");
  });

  it("keeps the SMS within one message", () => {
    const sms = renewalReminderSms(details, "https://verifiedproperties.co.ke/account/billing");
    expect(sms.length).toBeLessThanOrEqual(160);
  });
});
