/**
 * Signed-out security sweep against a running production build (prompt S19 decision 2.7).
 *
 *   npm run build
 *   UPSTASH_REDIS_REST_URL=http://127.0.0.1:9 UPSTASH_REDIS_REST_TOKEN=sweep npx next start -p 3005
 *   npm run security:sweep                      # base http://localhost:3005
 *
 * The placeholder Upstash values make a local production build behave like the live site, which
 * has a rate limiter configured. Without them every payment callback answers 500, because a
 * production build refuses to run without one. No check here reaches the limiter.
 *
 * Each account and admin page is requested twice:
 *  - with no cookie, which `src/proxy.ts` turns away;
 *  - with a forged session cookie, which passes the proxy's cookie-presence check and so proves
 *    the page's own guard (`requireUser` / `requireRole`) refuses it.
 *
 * It sends no real credentials and needs no secrets. It refuses any non-local base unless
 * `--allow-remote` is passed, so it is never aimed at the live site by accident.
 */
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const TIMEOUT_MS = 20_000;
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

interface Check {
  name: string;
  method: "GET" | "POST" | "PUT";
  path: string;
  /** Returns null when the response is as expected, or what was wrong. */
  expect: (res: SweepResponse) => string | null;
  body?: string;
  /** Send a made-up session cookie, to get past the proxy to the page's own guard. */
  forgedSession?: boolean;
}

/** Both Better Auth cookie names (plain on http, `__Secure-` on https), with a made-up token. */
const FORGED_SESSION_COOKIE = "vpk.session_token=s19-forged.token; __Secure-vpk.session_token=s19-forged.token";

interface SweepResponse {
  status: number;
  location: string | null;
  text: string;
}

function parseArgs(argv: string[]): { base: string; allowRemote: boolean } | string {
  let base = "http://localhost:3005";
  let allowRemote = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base") base = argv[++i] ?? "";
    else if (argv[i] === "--allow-remote") allowRemote = true;
    else return `Unknown argument: ${argv[i]}`;
  }
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    return `Not a URL: ${base}`;
  }
  if (!allowRemote && host !== "localhost" && host !== "127.0.0.1") {
    return `Refusing non-local base ${host}. Pass --allow-remote only if you mean it.`;
  }
  return { base: base.replace(/\/+$/, ""), allowRemote };
}

/** Static and dynamic page routes under a folder of src/app, with placeholder params. */
function pageRoutes(folder: string): string[] {
  const root = path.join(process.cwd(), "src", "app");
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name === "page.tsx") {
        const segments = path
          .relative(root, dir)
          .split(path.sep)
          .filter((s) => !/^\(.*\)$/.test(s))
          .map((s) => (s === "[invoiceNumber]" ? "VPK0000000" : /^\[.+\]$/.test(s) ? ZERO_UUID : s));
        out.push(`/${segments.join("/")}`);
      }
    }
  };
  walk(path.join(root, folder));
  return out.sort();
}

/** Signed-out visitors are sent to sign-in: a 3xx, or Next's streamed redirect inside a 200. */
function toSignIn(res: SweepResponse): string | null {
  if (res.status >= 300 && res.status < 400) {
    return res.location?.includes("/sign-in") ? null : `redirects to ${res.location}`;
  }
  const streamed = /NEXT_REDIRECT[^"]*\/sign-in|http-equiv="refresh"[^>]*\/sign-in/.test(res.text);
  if (res.status === 200 && streamed) return null;
  return `status ${res.status} without a sign-in redirect`;
}

const status =
  (...allowed: number[]) =>
  (res: SweepResponse): string | null =>
    allowed.includes(res.status) ? null : `status ${res.status}, expected ${allowed.join(" or ")}`;

/**
 * Admin navigation, titles and data sections that must never reach a non-admin, even in a
 * streamed shell (docs/SECURITY_TESTS.md, finding F1, fixed with `AdminGate`).
 */
const ADMIN_MARKERS = [
  "Listings queue",
  "Verification queue",
  "Billing admin",
  "Flagged payments",
  "Failed runs (last 7 days)",
  "Platform overview",
  "Listings awaiting moderation",
  "Verification reviews",
  "Record a Paybill payment",
  "Unmatched Paybill payment",
  "Reported conversation",
  "Jobs &amp; emails",
];

function noAdminMarkup(res: SweepResponse): string | null {
  const found = ADMIN_MARKERS.filter((m) => res.text.includes(m));
  return found.length ? `shows admin markup: ${found.join(", ")}` : null;
}

/** An admin page must not show any heading before its role check passes. */
function noHeading(res: SweepResponse): string | null {
  const h1 = /<h1[^>]*>([^<]+)<\/h1>/.exec(res.text);
  return h1 ? `shows a page heading: ${h1[1]}` : null;
}

const both =
  (...checks: ((res: SweepResponse) => string | null)[]) =>
  (res: SweepResponse) =>
    checks.map((c) => c(res)).find((r) => r !== null) ?? null;

function checks(): Check[] {
  const list: Check[] = [];
  for (const forgedSession of [false, true]) {
    const who = forgedSession ? "forged session" : "signed out";
    for (const p of pageRoutes("account")) list.push({ name: `${who} ${p}`, method: "GET", path: p, expect: both(toSignIn, noAdminMarkup), forgedSession });
    for (const p of pageRoutes("admin")) {
      list.push({ name: `${who} ${p}`, method: "GET", path: p, expect: both(toSignIn, noAdminMarkup, noHeading), forgedSession });
    }
  }
  list.push(
    {
      name: "verification document, signed out (proxy)",
      method: "GET",
      path: `/admin/verification/documents/${ZERO_UUID}`,
      expect: toSignIn,
    },
    {
      name: "verification document, forged session (route guard)",
      method: "GET",
      path: `/admin/verification/documents/${ZERO_UUID}`,
      expect: status(404),
      forgedSession: true,
    },
    {
      name: "message poll, forged session",
      method: "GET",
      path: "/api/messages/status",
      expect: status(401),
      forgedSession: true,
    },
    { name: "dev storage read is off in production", method: "GET", path: "/api/dev-storage/public/listings/x/photo", expect: status(404) },
    { name: "dev storage private read is off", method: "GET", path: "/api/dev-storage/private?t=x", expect: status(404) },
    { name: "dev storage upload is off", method: "PUT", path: "/api/dev-storage/upload?t=x", body: "x", expect: status(404) },
    { name: "STK callback with a wrong token", method: "POST", path: "/api/payments/stk/wrong-token-0000000000000", body: "{}", expect: status(404) },
    {
      name: "C2B validation with a wrong token",
      method: "POST",
      path: "/api/payments/c2b/validation/wrong-token-0000000000000",
      body: "{}",
      expect: status(404),
    },
    {
      name: "C2B confirmation with a wrong token",
      method: "POST",
      path: "/api/payments/c2b/confirmation/wrong-token-0000000000000",
      body: "{}",
      expect: status(404),
    },
    { name: "unsigned card webhook", method: "POST", path: "/api/payments/card/webhook", body: "{}", expect: status(400, 401, 403, 404) },
    { name: "unsigned QStash job call", method: "POST", path: "/api/jobs/reconcile", body: "{}", expect: status(401, 403, 404) },
    { name: "message poll without a session", method: "GET", path: "/api/messages/status", expect: status(401) },
    { name: "auth API refuses writes (actions only)", method: "POST", path: "/api/auth/sign-in/email", body: "{}", expect: status(404, 405) },
    {
      name: "unknown listing shows not found",
      method: "GET",
      path: "/properties/s19-sweep-no-such-listing",
      expect: (res) => (/Page not found/.test(res.text) ? null : `status ${res.status} without the not-found page`),
    },
  );
  return list;
}

async function send(base: string, check: Check): Promise<SweepResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (check.body) headers["content-type"] = "application/json";
    if (check.forgedSession) headers.cookie = FORGED_SESSION_COOKIE;
    const res = await fetch(`${base}${check.path}`, {
      method: check.method,
      redirect: "manual",
      body: check.body,
      headers,
      signal: controller.signal,
    });
    return { status: res.status, location: res.headers.get("location"), text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === "string") {
    console.error(args);
    return 1;
  }
  const list = checks();
  console.info(`Security sweep: ${list.length} checks against ${args.base} (signed out, no credentials)`);
  const rows: { check: string; result: string }[] = [];
  let failed = 0;
  for (const check of list) {
    let problem: string | null;
    try {
      problem = check.expect(await send(args.base, check));
    } catch (error) {
      problem = `request failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    if (problem) failed += 1;
    rows.push({ check: `${check.method} ${check.name}`, result: problem ? `FAIL: ${problem}` : "pass" });
  }
  console.table(rows);
  console.info(failed === 0 ? `All ${list.length} checks passed.` : `${failed} of ${list.length} checks failed.`);
  return failed === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("security-sweep failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
