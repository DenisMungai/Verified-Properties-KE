import { describe, expect, it } from "vitest";
import { scrubBreadcrumb, scrubEvent, scrubText } from "./scrub";

describe("Sentry scrubber (prompt S21 decision 4)", () => {
  it("masks emails, Kenyan phones, long tokens and URL credentials", () => {
    expect(scrubText("mail jane.doe@example.com now")).toBe("mail j•••@example.com now");
    expect(scrubText("call +254712345678 or 0712 345 678 or 254112345678")).toBe(
      "call +254 7•• ••• 678 or +254 7•• ••• 678 or +254 1•• ••• 678",
    );
    expect(scrubText("token abcdefghijklmnopqrstuvwxyz0123456789ABCD end")).toBe("token ••• end");
    expect(scrubText("postgresql://neondb_owner:s3cretPass@ep-x.neon.tech/db")).toBe("postgresql://•••:•••@ep-x.neon.tech/db");
  });

  it("keeps ordinary messages, ids and amounts", () => {
    const text = "Payment flagged invoice=VPK0000012 amount=1500 at 2026-11-10";
    expect(scrubText(text)).toBe(text);
    expect(scrubText("listing 3f2a9c1e-1234-4abc-8def-0123456789ab")).toBe("listing 3f2a9c1e-1234-4abc-8def-0123456789ab");
  });

  it("removes cookies, headers, body, query and user from events", () => {
    const event = scrubEvent({
      message: "Failed for buyer@example.com",
      user: { id: "u1", email: "buyer@example.com", ip_address: "203.0.113.5" },
      request: {
        url: "https://verifiedpropertieske.vercel.app/account?next=/x&email=a@b.co",
        method: "POST",
        cookies: { "vpk.session_token": "secret" },
        headers: { cookie: "vpk.session_token=secret", "x-real-ip": "203.0.113.5" },
        data: { phone: "0712345678" },
        query_string: "email=a@b.co",
      },
      exception: { values: [{ type: "Error", value: "Could not send to +254712345678" }] },
      extra: { nested: { email: "x@y.co" } },
    });
    expect(event.user).toBeUndefined();
    expect(event.request).toEqual({ url: "https://verifiedpropertieske.vercel.app/account", method: "POST" });
    expect(event.message).toBe("Failed for b•••@example.com");
    expect(event.exception?.values?.[0].value).toBe("Could not send to +254 7•• ••• 678");
    expect(JSON.stringify(event)).not.toMatch(/secret|203\.0\.113\.5|0712345678|x@y\.co/);
  });

  it("drops console breadcrumbs and scrubs the rest", () => {
    expect(scrubBreadcrumb({ category: "console", message: "anything" })).toBeNull();
    expect(scrubBreadcrumb({ category: "fetch", message: "to a@b.co", data: { url: "https://x.test/?t=abcdefghijklmnopqrstuvwxyz0123456789" } })).toEqual({
      category: "fetch",
      message: "to a•••@b.co",
      data: { url: "https://x.test/?t=•••" },
    });
    const event = scrubEvent({ breadcrumbs: [{ category: "console", message: "x" }, { category: "navigation", message: "/a" }] });
    expect(event.breadcrumbs).toEqual([{ category: "navigation", message: "/a", data: undefined }]);
  });
});
