/**
 * No dead links (plan v2.0 §12 "no dead links in header or footer"; prompt S20 decision 11).
 *
 * Every internal link in the header and footer, the account menu, the legal pages, How it works,
 * Pricing, sign-up and checkout must point at a real page, and a `#fragment` must exist on the
 * target page when that page's source is scanned here.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAIN_NAV, accountLinks } from "@/components/layout/nav";
import { DATA_REQUEST_PATH, LEGAL_PAGES } from "@/lib/legal";

const ROOT = process.cwd();
const APP = path.join(ROOT, "src", "app");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

interface Route {
  pattern: RegExp;
  file: string;
}

/** Every page route, with route groups dropped and dynamic segments as wildcards. */
const ROUTES: Route[] = walk(APP)
  .filter((f) => f.endsWith(`${path.sep}page.tsx`))
  .map((file) => {
    const segments = path
      .relative(APP, path.dirname(file))
      .split(path.sep)
      .filter((s) => s && !/^\(.*\)$/.test(s))
      .map((s) => (/^\[\.\.\..+\]$/.test(s) ? ".+" : /^\[.+\]$/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    return { pattern: new RegExp(`^/${segments.join("/")}$`), file };
  });

function routeFor(href: string): Route | undefined {
  const pathname = href.split("#")[0].split("?")[0] || "/";
  return ROUTES.find((r) => r.pattern.test(pathname === "/" ? "/" : pathname.replace(/\/$/, "")));
}

/** Files whose internal links are checked. */
const SCANNED = [
  ...walk(path.join(ROOT, "src", "components", "layout")),
  "src/components/legal/LegalPage.tsx",
  "src/app/privacy/page.tsx",
  "src/app/privacy/request/page.tsx",
  "src/app/terms/page.tsx",
  "src/app/subscription-policy/page.tsx",
  "src/app/moderation/page.tsx",
  "src/app/how-it-works/page.tsx",
  "src/app/pricing/page.tsx",
  "src/components/auth/SignUpForm.tsx",
  "src/components/billing/CheckoutForm.tsx",
  "src/app/properties/[slug]/page.tsx",
].map((f) => (path.isAbsolute(f) ? f : path.join(ROOT, f)));

/** Literal internal hrefs: `href="/x"`, `href={"/x"}`, `href: "/x"`, and template-free strings. */
function hrefsIn(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(/href(?:=\{?|:\s*)["'](\/[^"'\s]*)["']/g)) out.push(m[1]);
  return out;
}

const fromCode = [
  ...MAIN_NAV.map((l) => l.href),
  ...[false, true].flatMap((isLister) => [false, true].flatMap((isAdmin) => accountLinks({ isLister, isAdmin }).map((l) => l.href))),
  ...LEGAL_PAGES.map((l) => l.href),
  DATA_REQUEST_PATH,
];

describe("internal links", () => {
  it("scans real files and finds links in them", () => {
    const found = SCANNED.flatMap((f) => hrefsIn(readFileSync(f, "utf8")));
    expect(found.length).toBeGreaterThan(20);
  });

  it("every navigation and legal link points at a page that exists", () => {
    const dead = [...new Set(fromCode)].filter((href) => !routeFor(href));
    expect(dead, "links with no page").toEqual([]);
  });

  it("every literal internal link in the scanned files points at a page that exists", () => {
    const dead: string[] = [];
    for (const file of SCANNED) {
      for (const href of hrefsIn(readFileSync(file, "utf8"))) {
        if (!routeFor(href)) dead.push(`${path.relative(ROOT, file)}: ${href}`);
      }
    }
    expect(dead, "links with no page").toEqual([]);
  });

  it("every #fragment exists on its target page", () => {
    const missing: string[] = [];
    const links = [...fromCode, ...SCANNED.flatMap((f) => hrefsIn(readFileSync(f, "utf8")))];
    for (const href of new Set(links.filter((h) => h.includes("#")))) {
      const fragment = href.split("#")[1];
      const target = routeFor(href);
      if (!target) continue; // reported by the test above
      const source = readFileSync(target.file, "utf8");
      if (!new RegExp(`id[=:]\\s*["'{]?["']?${fragment}["']`).test(source)) missing.push(href);
    }
    expect(missing, "fragments with no matching id").toEqual([]);
  });

  it("the footer lists every legal page", () => {
    const footer = readFileSync(path.join(ROOT, "src", "components", "layout", "SiteFooter.tsx"), "utf8");
    expect(footer).toMatch(/LEGAL_PAGES\.map/);
    expect(LEGAL_PAGES.map((l) => l.href)).toEqual(["/privacy", "/terms", "/subscription-policy", "/moderation"]);
  });
});
