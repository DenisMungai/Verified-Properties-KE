/**
 * Log hygiene scan (prompt S21 decision 5; AGENTS.md §8: logs carry no secrets or personal data).
 *
 * Every `console.*` call under `src/` is checked for values that can carry personal data or raw
 * provider text:
 *  - `.message` of an error;
 *  - a bare error interpolated or passed (`${error}`, `${result.error}`, `, error)`);
 *  - an email or phone interpolated without `maskEmail` / `maskPhone`.
 * Errors go through `errorName`, provider failures through `providerCode`. Plain source matching,
 * like `src/app/route-guards.test.ts`: it catches the pattern, not every possible leak.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

/** Named exceptions: `file` → why its flagged call is safe. Keep this short. */
const ALLOWLIST: Record<string, string> = {};

const RULES: { name: string; pattern: RegExp }[] = [
  { name: "error .message", pattern: /\.message\b/ },
  { name: "raw error interpolated", pattern: /\$\{\s*(?:[\w.]*\.)?(?:error|err|e)\s*\}/ },
  { name: "raw error passed", pattern: /,\s*(?:[\w.]*\.)?(?:error|err|e)\s*\)\s*;?\s*$/ },
  { name: "unmasked email or phone", pattern: /\$\{\s*[\w.]*(?:email|phone|e164)\s*\}/i },
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const rel = (file: string) => path.relative(process.cwd(), file).split(path.sep).join("/");

/** The text of each `console.x(...)` call, matched to its closing parenthesis. */
function consoleCalls(source: string): string[] {
  const calls: string[] = [];
  const start = /\bconsole\.(?:log|info|warn|error|debug)\(/g;
  for (let match = start.exec(source); match; match = start.exec(source)) {
    let depth = 0;
    let end = match.index + match[0].length - 1;
    for (; end < source.length; end++) {
      if (source[end] === "(") depth++;
      else if (source[end] === ")" && --depth === 0) break;
    }
    calls.push(source.slice(match.index, end + 1).replace(/\s+/g, " "));
  }
  return calls;
}

const FILES = walk(SRC);

describe("log hygiene", () => {
  it("finds the logging code", () => {
    expect(FILES.filter((f) => consoleCalls(readFileSync(f, "utf8")).length > 0).length).toBeGreaterThan(20);
  });

  it("matches the patterns it is meant to catch", () => {
    const flagged = (call: string) => RULES.some((rule) => rule.pattern.test(call));
    expect(flagged("console.error(`x error=${error}`)")).toBe(true);
    expect(flagged("console.error(`x error=${result.error}`)")).toBe(true);
    expect(flagged('console.error("x", error.message)')).toBe(true);
    expect(flagged('console.error("x", error)')).toBe(true);
    expect(flagged("console.error(`to=${recipient.email}`)")).toBe(true);
    expect(flagged("console.error(`to=${maskEmail(recipient.email)} error=${errorName(e)}`)")).toBe(false);
    expect(flagged("console.error(`error=${providerCode(result.error)}`)")).toBe(false);
    expect(flagged('console.error("x", error instanceof Error ? error.name : "unknown")')).toBe(false);
  });

  it("logs no raw errors, provider text, emails or phones", () => {
    const problems: string[] = [];
    for (const file of FILES) {
      if (ALLOWLIST[rel(file)]) continue;
      for (const call of consoleCalls(readFileSync(file, "utf8"))) {
        for (const rule of RULES) if (rule.pattern.test(call)) problems.push(`${rel(file)}: ${rule.name}: ${call.slice(0, 160)}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("allowlisted files exist and still need their exception", () => {
    for (const file of Object.keys(ALLOWLIST)) {
      const calls = consoleCalls(readFileSync(path.join(process.cwd(), file), "utf8"));
      expect(calls.some((call) => RULES.some((rule) => rule.pattern.test(call))), file).toBe(true);
    }
  });
});
