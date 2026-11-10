/**
 * Static security scan (prompt S19, decisions 2.3–2.5; plan §12).
 *
 * - Every admin and account page and route calls its session guard.
 * - Every exported Server Action is guarded, or is a named public action.
 * - Admin guards use admin-only role sets.
 * - The abuse-prone actions apply their rate-limit policies.
 * - Server-only values on the public listing page never reach JSX.
 *
 * A new file that skips its guard fails here with its path. This is plain source matching, not
 * a type-checked analysis: it catches the missing guard, and the integration suites prove the
 * guards behave.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADMIN_ROLES } from "@/lib/roles";

const APP = path.join(process.cwd(), "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rel = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/");
const read = (file: string) => readFileSync(file, "utf8");
const ALL = walk(APP);

/** Session guards from `src/lib/session.ts` and `src/app/account/listings/guard.ts`. */
/** A call, awaited directly or inside `Promise.all([...])`. Imports have no `(` and don't match. */
const GUARD = /\b(requireRole|requireUser|requireLister)\(/;

/**
 * Shared helpers that run a session guard first. Each entry names where its guard lives, and the
 * test below checks that the guard is really there.
 */
const GUARDED_HELPERS: Record<string, { file: string; guard: RegExp }> = {
  // Listing editor pages: requireLister, then the owner-scoped listing lookup.
  loadEditableListing: { file: "src/app/account/listings/editor-data.ts", guard: /await requireLister\(/ },
  // Verification documents: platform admins only, audited (S17 F1 integration test).
  openDocumentForAdmin: { file: "src/lib/verification/document-view.ts", guard: /platform_admin/ },
};

function guarded(source: string): boolean {
  return GUARD.test(source) || Object.keys(GUARDED_HELPERS).some((name) => new RegExp(`\\b${name}\\(`).test(source));
}

/* ------------------------------------------------------------------------------------------ */
/* Pages and routes                                                                           */
/* ------------------------------------------------------------------------------------------ */

const ENTRY = /[\\/](page\.tsx|route\.ts)$/;
const under = (prefix: string) => ALL.filter((f) => rel(f).startsWith(prefix) && ENTRY.test(f));

describe("pages and routes", () => {
  it("the guarded helpers really run their guard", () => {
    for (const [name, { file, guard }] of Object.entries(GUARDED_HELPERS)) {
      const source = read(path.join(process.cwd(), file));
      expect(source, `${name} in ${file}`).toMatch(new RegExp(`export async function ${name}\\(`));
      expect(source, `${name} guard in ${file}`).toMatch(guard);
    }
  });

  it("every admin page and route checks an admin role", () => {
    const files = under("src/app/admin/");
    expect(files.length).toBeGreaterThan(10);
    const missing = files.filter((f) => {
      const source = read(f);
      return !/\brequireRole\(/.test(source) && !/\bopenDocumentForAdmin\(/.test(source);
    });
    expect(missing.map(rel), "admin files without requireRole").toEqual([]);
  });

  it("every account page and route checks the session", () => {
    const files = under("src/app/account/");
    expect(files.length).toBeGreaterThan(10);
    const missing = files.filter((f) => !guarded(read(f)));
    expect(missing.map(rel), "account files without a session guard").toEqual([]);
  });

  it("renders nothing of an admin page before its role check (finding F1)", () => {
    const pages = under("src/app/admin/").filter((f) => f.endsWith("page.tsx"));
    expect(pages.length).toBe(12);
    const problems: string[] = [];
    for (const file of pages) {
      const source = read(file);
      const body = source.slice(source.indexOf("export default function"));
      const ret = body.slice(body.indexOf("return ("));
      const gate = ret.indexOf("<AdminGate ");
      if (!/^return \(\s*<Suspense fallback=\{[^]*?\}>\s*<AdminGate /.test(ret)) problems.push(`${rel(file)}: body is not <Suspense><AdminGate>`);
      else if (/PageHeading|<h1|<Link/.test(ret.slice(0, gate))) problems.push(`${rel(file)}: renders before AdminGate`);
      // Titles sit in the prerendered head, so admin pages share the layout's neutral "Admin".
      if (/export (const metadata|(async )?function generateMetadata)/.test(source)) problems.push(`${rel(file)}: sets its own title`);
    }
    expect(read(path.join(APP, "admin", "layout.tsx"))).toMatch(/export const metadata: Metadata = \{ title: "Admin"/);
    expect(problems).toEqual([]);
  });

  it("admin guards pass only admin role sets", () => {
    const allowedLiterals = new Set(['["platform_admin"]', '["platform_admin", "billing_admin"]']);
    const constants: Record<string, string> = {};
    for (const file of ALL.filter((f) => rel(f).startsWith("src/app/admin/"))) {
      const source = read(file);
      for (const m of source.matchAll(/const (\w+) = (\[[^\]]*\]) as const;/g)) constants[m[1]] = m[2];
      for (const m of source.matchAll(/(?:requireRole\(\s*([^,)]+)|<AdminGate roles=\{(\[[^\]]*\]|\w+)\})/g)) {
        const arg = (m[1] ?? m[2]).trim();
        const literal = arg === "ADMIN_ROLES" ? JSON.stringify([...ADMIN_ROLES]).replace(/,/g, ", ") : (constants[arg] ?? arg);
        expect(allowedLiterals.has(literal), `${rel(file)}: requireRole(${arg}) = ${literal}`).toBe(true);
      }
    }
    expect([...ADMIN_ROLES].sort()).toEqual(["billing_admin", "platform_admin"]);
  });
});

/* ------------------------------------------------------------------------------------------ */
/* Server Actions                                                                             */
/* ------------------------------------------------------------------------------------------ */

interface ActionFn {
  name: string;
  body: string;
}

/** Index just past the bracket that closes the one at `open` (same kind, nesting counted). */
function matchingClose(source: string, open: number): number {
  const pair: Record<string, string> = { "(": ")", "{": "}" };
  const opener = source[open];
  const closer = pair[opener];
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === opener) depth++;
    else if (source[i] === closer && --depth === 0) return i + 1;
  }
  return source.length;
}

/**
 * Top-level functions of a file, signature and body. The body is the first `{` after the
 * parameter list that is not inside the return type's `<…>`, matched to its closing `}`.
 */
function functionsOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/^(?:export )?(?:async )?function (\w+)\(/gm)) {
    const start = m.index ?? 0;
    let i = matchingClose(source, start + m[0].length - 1);
    let angle = 0;
    for (; i < source.length; i++) {
      const c = source[i];
      if (c === "<") angle++;
      else if (c === ">" && source[i - 1] !== "=") angle--;
      else if (c === "{" && angle === 0) break;
      else if (c === "{") i = matchingClose(source, i) - 1;
    }
    out.set(m[1], source.slice(start, matchingClose(source, i)));
  }
  return out;
}

function exportedActions(source: string): ActionFn[] {
  const all = functionsOf(source);
  return [...source.matchAll(/^export async function (\w+)\(/gm)].map((m) => ({ name: m[1], body: all.get(m[1]) ?? "" }));
}

/**
 * True when the body calls a session guard, directly or through a local helper of the same file
 * (up to three levels: `withReason` → `requireRole`, `signedInUser` → verified session).
 */
function bodyIsGuarded(body: string, locals: Map<string, string>, depth = 0): boolean {
  if (GUARD.test(body) || /\bloadEditableListing\(/.test(body)) return true;
  if (/\bawait\s+signedInUser\(\)/.test(body) && /function signedInUser\(\)[\s\S]*?emailVerified/.test([...locals.values()].join("\n"))) {
    return true;
  }
  if (depth >= 3) return false;
  for (const [name, helperBody] of locals) {
    if (helperBody === body) continue;
    if (new RegExp(`\\b${name}\\(`).test(body) && bodyIsGuarded(helperBody, locals, depth + 1)) return true;
  }
  return false;
}

/**
 * Actions open to signed-out visitors, and why each is safe. Each one's policies must appear in
 * its body (rate-limit wiring, decision 2.5).
 */
const PUBLIC_ACTIONS: Record<string, { file: string; policies: string[]; why: string }> = {
  signInAction: { file: "src/app/(auth)/actions.ts", policies: ["signInPerEmail", "signInPerIp"], why: "signing in" },
  signUpAction: { file: "src/app/(auth)/actions.ts", policies: ["signUpPerIp"], why: "creating an account" },
  forgotPasswordAction: { file: "src/app/(auth)/actions.ts", policies: ["resetPerEmail", "resetPerIp"], why: "requesting a reset email" },
  resetPasswordAction: { file: "src/app/(auth)/actions.ts", policies: [], why: "needs the one-time token from the reset email" },
  resendVerificationAction: { file: "src/app/(auth)/actions.ts", policies: ["resendPerEmail"], why: "re-sending the verification email" },
  signOutAction: { file: "src/app/(auth)/actions.ts", policies: [], why: "ends only the caller's own session" },
  recordListingViewAction: { file: "src/app/properties/actions.ts", policies: ["listingViewPerVisitor"], why: "counts a public view, returns nothing" },
};

/** Guarded actions that must also apply a rate limit (plan §12: login, inquiry, messaging, STK). */
const RATE_LIMITED: Record<string, { file: string; policies: string[] }> = {
  sendInquiryAction: { file: "src/app/properties/actions.ts", policies: ["inquiryPerUser"] },
  reportListingAction: { file: "src/app/properties/actions.ts", policies: ["reportPerUser"] },
  toggleSaveAction: { file: "src/app/properties/actions.ts", policies: ["favoritePerUser"] },
  sendMessageAction: { file: "src/app/account/messages/actions.ts", policies: ["messagePerUser"] },
  reportMessageAction: { file: "src/app/account/messages/actions.ts", policies: ["messageReportPerUser"] },
  requestPhotoUploadAction: { file: "src/app/account/listings/photo-actions.ts", policies: ["photoUploadPerUser"] },
  changePasswordAction: { file: "src/app/account/actions.ts", policies: ["passwordChangePerUser"] },
};

/** STK and card starts apply their limits inside the payment module the actions call. */
const PAYMENT_LIMITS: { file: string; policies: string[] }[] = [
  { file: "src/lib/mpesa/start-payment.ts", policies: ["paymentStartPerUser", "paymentStartPerPhone"] },
  { file: "src/lib/card/start-card-payment.ts", policies: ["paymentStartPerUser"] },
];

const ACTION_FILES = ALL.filter((f) => /actions\.ts$/.test(f) && !f.endsWith(".test.ts"));

/** True when the policy is used in the body, or in a local helper the body calls. */
function usesPolicy(body: string, locals: Map<string, string>, policy: string): boolean {
  const re = new RegExp(`POLICIES\\.${policy}\\b`);
  if (re.test(body)) return true;
  return [...locals].some(([name, helper]) => helper !== body && new RegExp(`\\b${name}\\(`).test(body) && re.test(helper));
}

describe("server actions", () => {
  it("finds the action files", () => {
    expect(ACTION_FILES.length).toBeGreaterThanOrEqual(12);
  });

  it("guards every exported action, or names it as public", () => {
    const unguarded: string[] = [];
    for (const file of ACTION_FILES) {
      const source = read(file);
      expect(source.startsWith('"use server"'), `${rel(file)} starts with "use server"`).toBe(true);
      const locals = functionsOf(source);
      for (const action of exportedActions(source)) {
        if (PUBLIC_ACTIONS[action.name]?.file === rel(file)) continue;
        if (!bodyIsGuarded(action.body, locals)) unguarded.push(`${rel(file)}: ${action.name}`);
      }
    }
    expect(unguarded, "exported actions without a session guard").toEqual([]);
  });

  it("public actions exist where named and apply their rate limits", () => {
    for (const [name, { file, policies }] of Object.entries(PUBLIC_ACTIONS)) {
      const source = read(path.join(process.cwd(), file));
      const locals = functionsOf(source);
      const body = locals.get(name);
      expect(body, `${name} in ${file}`).toBeDefined();
      for (const policy of policies) expect(usesPolicy(body!, locals, policy), `${name} uses POLICIES.${policy}`).toBe(true);
    }
  });

  it("abuse-prone signed-in actions apply their rate limits", () => {
    for (const [name, { file, policies }] of Object.entries(RATE_LIMITED)) {
      const source = read(path.join(process.cwd(), file));
      const locals = functionsOf(source);
      const body = locals.get(name);
      expect(body, `${name} in ${file}`).toBeDefined();
      for (const policy of policies) expect(usesPolicy(body!, locals, policy), `${name} uses POLICIES.${policy}`).toBe(true);
    }
    for (const { file, policies } of PAYMENT_LIMITS) {
      const source = read(path.join(process.cwd(), file));
      for (const policy of policies) expect(source, `${file} uses POLICIES.${policy}`).toMatch(new RegExp(`POLICIES\\.${policy}\\b`));
    }
  });
});

/* ------------------------------------------------------------------------------------------ */
/* API routes and server-only values                                                          */
/* ------------------------------------------------------------------------------------------ */

describe("api routes", () => {
  const route = (p: string) => read(path.join(APP, ...p.split("/"), "route.ts"));

  it("only exports GET from the auth handler (every auth write goes through a rate-limited action)", () => {
    const source = route("api/auth/[...all]");
    expect(source).toMatch(/export async function GET\(/);
    expect(source).not.toMatch(/export (async function|const) (POST|PUT|PATCH|DELETE)\b/);
  });

  it("checks the session on the message status poll and rate-limits it", () => {
    const source = route("api/messages/status");
    expect(source).toMatch(/getCurrentUser\(\)/);
    expect(source).toMatch(/POLICIES\.messagePollPerUser/);
  });

  it("hands payment callbacks and job calls to their verifiers", () => {
    expect(route("api/payments/stk/[token]")).toMatch(/token/);
    expect(route("api/jobs/[job]")).toMatch(/signature|verify/i);
    expect(route("api/payments/card/webhook")).toMatch(/signature/i);
  });
});

describe("server-only values", () => {
  it("never passes the listing owner id into the public listing page's JSX", () => {
    const source = read(path.join(APP, "properties", "[slug]", "page.tsx"));
    const uses = source.split("\n").filter((line) => line.includes("ownerUserId"));
    expect(uses.length).toBeGreaterThan(0);
    for (const line of uses) {
      expect(line, "ownerUserId as a JSX prop or child").not.toMatch(/\w+=\{[^}]*ownerUserId|\{ownerUserId\}\s*</);
      expect(line, "ownerUserId in a spread").not.toMatch(/\{\.\.\.[^}]*ownerUserId/);
    }
  });
});
