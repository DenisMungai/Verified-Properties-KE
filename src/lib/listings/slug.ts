import { randomBytes } from "node:crypto";

/**
 * "Bright 2-bedroom flat, Kilimani!" -> "bright-2-bedroom-flat-kilimani-a1b2c3". Set once when the
 * draft is created and never changed by edits, so shared links keep working.
 */
export function makeSlug(title: string, suffix: string = randomBytes(3).toString("hex")): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${base || "property"}-${suffix}`;
}
