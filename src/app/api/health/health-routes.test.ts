/** The two health routes (prompt S21 decisions 2–3), with the database and env mocked. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ping = vi.fn<() => Promise<void>>();
const jobs = vi.fn();
const pushes = vi.fn();
let opsToken: string | undefined = "t".repeat(32);

vi.mock("next/server", () => ({ connection: async () => undefined }));
vi.mock("@/db", () => ({ getDb: () => ({}) }));
vi.mock("@/db/queries/ops-health", () => ({
  pingDatabase: () => ping(),
  readJobHealth: () => jobs(),
  readPushStats: () => pushes(),
}));
vi.mock("@/lib/env", () => ({ getServerEnv: () => ({ OPS_HEALTH_TOKEN: opsToken }) }));

const health = await import("./route");
const ops = await import("./ops/[token]/route");

const call = (token: string) => ops.GET(new Request("http://x.test"), { params: Promise.resolve({ token }) });

describe("GET /api/health", () => {
  beforeEach(() => { ping.mockReset(); });

  it("returns only { status: ok } when the database answers", async () => {
    ping.mockResolvedValue(undefined);
    const res = await health.GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("returns 503 { status: down } and no error text when it doesn't", async () => {
    ping.mockImplementation(async () => {
      throw new Error("password authentication failed for user neondb_owner");
    });
    const res = await health.GET();
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"status":"down"}');
  });
});

describe("GET /api/health/ops/[token]", () => {
  beforeEach(() => {
    opsToken = "t".repeat(32);
    jobs.mockResolvedValue(new Map());
    pushes.mockResolvedValue({ pushes: 0, missing: 0 });
  });

  it("404s with no body for a wrong or missing token, or when no token is configured", async () => {
    for (const token of ["wrong", "t".repeat(31), ""]) {
      const res = await call(token);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("");
    }
    opsToken = undefined;
    expect((await call("t".repeat(32))).status).toBe(404);
  });

  it("returns 200 with every check ok on a healthy system", async () => {
    const res = await call("t".repeat(32));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "ok",
      checks: { database: "ok", jobs_overdue: "ok", jobs_failing: "ok", payment_callbacks: "ok" },
    });
  });

  it("returns 503 naming payment_callbacks when callbacks stall", async () => {
    pushes.mockResolvedValue({ pushes: 3, missing: 2 });
    const res = await call("t".repeat(32));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "fail", checks: { payment_callbacks: "fail" } });
  });

  it("returns 503 naming only the database when reads fail", async () => {
    jobs.mockImplementation(async () => {
      throw new Error("boom");
    });
    const res = await call("t".repeat(32));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ checks: { database: "fail" } });
  });
});
