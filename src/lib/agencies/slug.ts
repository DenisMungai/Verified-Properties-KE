/**
 * Agency URL slugs (prompt S23 decision 3): made once from the name and never changed, so links
 * keep working after a rename. Lower-case ASCII words joined by hyphens, at most 60 characters,
 * matching the `agencies_slug_format` check.
 */

export const AGENCY_SLUG_MAX = 60;

/** "Acme Réalty & Sons Ltd." → "acme-realty-sons-ltd". Falls back to "agency" for names with no letters or digits. */
export function agencySlugBase(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > AGENCY_SLUG_MAX) break;
    slug = next;
  }
  // A single word longer than the limit is cut rather than dropped.
  if (!slug && words[0]) slug = words[0].slice(0, AGENCY_SLUG_MAX);
  return slug || "agency";
}

/** The slug to try on attempt `n` (1-based): "acme", then "acme-2", "acme-3", … */
export function agencySlugCandidate(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const suffix = `-${attempt}`;
  return `${base.slice(0, AGENCY_SLUG_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
}
