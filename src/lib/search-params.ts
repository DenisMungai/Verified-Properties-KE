import { DEFAULT_SIGNED_IN_PATH, safeNextPath } from "@/lib/safe-redirect";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** A safe `next` destination worth carrying through links, or undefined for the default. */
export function carriedNext(value: string | string[] | undefined): string | undefined {
  const next = safeNextPath(single(value));
  return next === DEFAULT_SIGNED_IN_PATH ? undefined : next;
}
