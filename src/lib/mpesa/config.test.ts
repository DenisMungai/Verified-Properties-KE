import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";
import { guardCallback, readJsonBody } from "./callback-request";
import { callbackUrl, CALLBACK_PATHS, mpesaModeFor, mpesaSettingsFor } from "./config";
import { createSimulatorClient, SimulatorInProductionError } from "./simulator";

const TOKEN = "t".repeat(32);
const base = { DATABASE_URL: "postgres://x", MPESA_CALLBACK_TOKEN: TOKEN };
const daraja = {
  MPESA_CONSUMER_KEY: "k",
  MPESA_CONSUMER_SECRET: "s",
  MPESA_SHORTCODE: "174379",
  MPESA_PASSKEY: "p",
};

describe("M-Pesa mode", () => {
  it("uses Daraja when every credential is set, in any environment", () => {
    expect(mpesaModeFor(parseServerEnv({ ...base, ...daraja }), "production")).toBe("daraja");
    expect(mpesaModeFor(parseServerEnv({ ...base, ...daraja }), "development")).toBe("daraja");
  });

  it("falls back to the simulator only outside production", () => {
    expect(mpesaModeFor(parseServerEnv(base), "development")).toBe("simulator");
    expect(mpesaModeFor(parseServerEnv(base), "production")).toBe("none");
    expect(mpesaSettingsFor(parseServerEnv(base), "production")).toBeNull();
  });

  it("needs a callback token", () => {
    expect(mpesaSettingsFor(parseServerEnv({ DATABASE_URL: "postgres://x", ...daraja }), "development")).toBeNull();
  });

  it("never builds the simulator in production", () => {
    expect(() => createSimulatorClient(async () => null, "production")).toThrow(SimulatorInProductionError);
  });

  it("builds callback URLs without mpesa/safaricom/query in the path", () => {
    const settings = mpesaSettingsFor(
      parseServerEnv({ ...base, MPESA_CALLBACK_BASE_URL: "https://tunnel.example/" }),
      "development",
    )!;
    const url = callbackUrl(settings, CALLBACK_PATHS.stk);
    expect(url).toBe(`https://tunnel.example/api/payments/stk/${TOKEN}`);
    for (const path of Object.values(CALLBACK_PATHS)) expect(path).not.toMatch(/mpesa|m-pesa|safaricom|query/i);
  });

  it("enforces the allowlist in production by default and in sandbox only when set", () => {
    const prod = mpesaSettingsFor(parseServerEnv({ ...base, ...daraja, MPESA_ENV: "production" }), "production")!;
    expect(prod.allowedIps).toHaveLength(3);
    expect(mpesaSettingsFor(parseServerEnv(base), "development")!.allowedIps).toBeNull();
    const sandbox = mpesaSettingsFor(parseServerEnv({ ...base, MPESA_CALLBACK_ALLOWED_IPS: "196.201.214.0/24" }), "development")!;
    expect(sandbox.allowedIps).toHaveLength(1);
  });
});

describe("callback guard", () => {
  const open = mpesaSettingsFor(parseServerEnv(base), "development")!;
  const locked = mpesaSettingsFor(parseServerEnv({ ...base, MPESA_CALLBACK_ALLOWED_IPS: "196.201.214.0/24" }), "development")!;

  it("answers 404 for a wrong token or when M-Pesa is off", () => {
    expect(guardCallback(open, "wrong", new Headers())).toEqual({ ok: false, status: 404 });
    expect(guardCallback(null, TOKEN, new Headers())).toEqual({ ok: false, status: 404 });
  });

  it("answers 403 for a forged IP when the allowlist is enforced", () => {
    expect(guardCallback(locked, TOKEN, new Headers({ "x-real-ip": "41.90.1.1" }))).toEqual({
      ok: false,
      status: 403,
      ip: "41.90.1.1",
    });
    expect(guardCallback(locked, TOKEN, new Headers({ "x-real-ip": "196.201.214.200" }))).toEqual({
      ok: true,
      ip: "196.201.214.200",
    });
  });

  it("lets any IP through when the allowlist is not enforced", () => {
    expect(guardCallback(open, TOKEN, new Headers())).toEqual({ ok: true, ip: null });
  });
});

describe("readJsonBody", () => {
  const post = (body: string, headers: Record<string, string> = {}) =>
    new Request("http://localhost/x", { method: "POST", body, headers });

  it("parses JSON within the cap", async () => {
    expect(await readJsonBody(post('{"a":1}'))).toEqual({ ok: true, json: { a: 1 } });
  });

  it("refuses oversized and invalid bodies", async () => {
    expect(await readJsonBody(post("x".repeat(100)), 50)).toEqual({ ok: false, status: 413 });
    expect(await readJsonBody(post("{}", { "content-length": "999999" }))).toEqual({ ok: false, status: 413 });
    expect(await readJsonBody(post("not json"))).toEqual({ ok: false, status: 400 });
  });
});
