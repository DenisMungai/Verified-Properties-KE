import { describe, expect, it } from "vitest";
import { messageAlertEmail, reviewDigestEmail } from "@/lib/email/templates";
import { countsLabel, durationLabel, isOverdue, runBadge, timeAgo } from "@/lib/jobs/admin-view";
import { MINUTE_MS, retryBackoffMs } from "./constants";
import { alertSkipReason } from "./message-alerts";
import { nairobiDateKey, waitLabel } from "./review-digest";

const HOUR = 60 * MINUTE_MS;
const url = "https://app.example/account/messages/0b6f3a1e-0000-4000-8000-000000000001";

describe("messageAlertEmail", () => {
  it("names the listing and count, links to the conversation, and uses the first name only", () => {
    const email = messageAlertEmail("Wanjiru Kamau", { listingTitle: "2 bedroom apartment, Kilimani", unreadCount: 3 }, url);
    expect(email.subject).toBe("New message about 2 bedroom apartment, Kilimani");
    expect(email.text).toContain("Hi Wanjiru, you have 3 new messages about 2 bedroom apartment, Kilimani.");
    expect(email.text).not.toContain("Kamau");
    expect(email.text).toContain(url);
    expect(email.html).toContain(url);
  });

  it("says 1 new message for a single unread message (and never less)", () => {
    expect(messageAlertEmail("A", { listingTitle: "Plot", unreadCount: 1 }, url).text).toContain("1 new message about Plot");
    expect(messageAlertEmail("A", { listingTitle: "Plot", unreadCount: 0 }, url).text).toContain("1 new message about Plot");
  });

  it("escapes the title in html and keeps the subject to one short line", () => {
    const title = `<img src=x onerror=alert(1)> Big\nhouse ${"x".repeat(80)}`;
    const email = messageAlertEmail("A", { listingTitle: title, unreadCount: 1 }, url);
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
    expect(email.subject).not.toContain("\n");
    expect(email.subject.length).toBeLessThanOrEqual("New message about ".length + 60);
    expect(email.subject.endsWith("…")).toBe(true);
  });
});

describe("reviewDigestEmail", () => {
  const urls = { listings: "https://app.example/admin/listings", verification: "https://app.example/admin/verification" };

  it("gives counts and oldest waits, and both links in the text", () => {
    const email = reviewDigestEmail(
      "Achieng Otieno",
      { listings: { count: 3, oldest: "2 days" }, verifications: { count: 0, oldest: null }, overdueHours: 24 },
      urls,
    );
    expect(email.subject).toBe("3 items waiting for review");
    expect(email.text).toContain("Listings waiting over 24 hours: 3 (oldest 2 days)");
    expect(email.text).toContain("Verifications waiting over 24 hours: 0");
    expect(email.text).toContain(urls.listings);
    expect(email.text).toContain(urls.verification);
    expect(email.text).not.toContain("Otieno");
  });

  it("uses the singular for one item", () => {
    const email = reviewDigestEmail("A", { listings: { count: 0, oldest: null }, verifications: { count: 1, oldest: "30 hours" }, overdueHours: 24 }, urls);
    expect(email.subject).toBe("1 item waiting for review");
  });
});

describe("alertSkipReason", () => {
  const ok = { read: false, closed: false, blocked: false, emailVerified: true };

  it("sends only when nothing stops it", () => {
    expect(alertSkipReason(ok)).toBeNull();
  });

  it("names the first reason, read first", () => {
    expect(alertSkipReason({ ...ok, read: true, closed: true })).toBe("read");
    expect(alertSkipReason({ ...ok, closed: true, blocked: true })).toBe("conversation_closed");
    expect(alertSkipReason({ ...ok, blocked: true })).toBe("blocked");
    expect(alertSkipReason({ ...ok, emailVerified: false })).toBe("email_unverified");
  });
});

describe("retry backoff", () => {
  it("waits about 10 minutes after the first failure and 20 after the second", () => {
    expect(retryBackoffMs(1)).toBe(10 * MINUTE_MS);
    expect(retryBackoffMs(2)).toBe(20 * MINUTE_MS);
  });
});

describe("review digest helpers", () => {
  it("keys the digest by the Nairobi date", () => {
    expect(nairobiDateKey(new Date("2026-11-08T05:00:00Z"))).toBe("2026-11-08");
    // 22:30 UTC is already the next day in Nairobi.
    expect(nairobiDateKey(new Date("2026-11-08T22:30:00Z"))).toBe("2026-11-09");
  });

  it("labels waits in hours under two days, then days", () => {
    const now = new Date("2026-11-08T05:00:00Z");
    expect(waitLabel(new Date(now.getTime() - 25 * HOUR), now)).toBe("25 hours");
    expect(waitLabel(new Date(now.getTime() - HOUR), now)).toBe("1 hour");
    expect(waitLabel(new Date(now.getTime() - 73 * HOUR), now)).toBe("3 days");
  });
});

describe("admin view", () => {
  const now = new Date("2026-11-08T05:00:00Z");
  const run = (status: string, counts: Record<string, number> = {}, minutesAgo = 1) => ({
    status,
    counts,
    startedAt: new Date(now.getTime() - minutesAgo * MINUTE_MS),
  });

  it("maps runs to badges", () => {
    expect(runBadge(undefined, now)).toBe("never");
    expect(runBadge(run("ok"), now)).toBe("ok");
    expect(runBadge(run("ok", { failed: 2 }), now)).toBe("partial");
    expect(runBadge(run("failed"), now)).toBe("failed");
    expect(runBadge(run("skipped"), now)).toBe("skipped");
    expect(runBadge(run("running", {}, 2), now)).toBe("running");
    expect(runBadge(run("running", {}, 16), now)).toBe("stuck");
  });

  it("is overdue with no finished run in twice the interval, but not when never run", () => {
    expect(isOverdue(undefined, false, HOUR, now)).toBe(false);
    expect(isOverdue(undefined, true, HOUR, now)).toBe(true);
    expect(isOverdue(new Date(now.getTime() - 90 * MINUTE_MS), true, HOUR, now)).toBe(false);
    expect(isOverdue(new Date(now.getTime() - 3 * HOUR), true, HOUR, now)).toBe(true);
  });

  it("formats times, durations and counts", () => {
    expect(timeAgo(new Date(now.getTime() - 30_000), now)).toBe("just now");
    expect(timeAgo(new Date(now.getTime() - 4 * MINUTE_MS), now)).toBe("4 min ago");
    expect(timeAgo(new Date(now.getTime() - 3 * HOUR), now)).toBe("3 h ago");
    expect(timeAgo(new Date(now.getTime() - 50 * HOUR), now)).toBe("2 days ago");
    expect(durationLabel(null)).toBe("–");
    expect(durationLabel(420)).toBe("420 ms");
    expect(durationLabel(2500)).toBe("2.5 s");
    expect(countsLabel({ candidates: 3, failed: 1, none: 0 })).toBe("candidates 3 · failed 1");
    expect(countsLabel({})).toBe("No counts");
  });
});
