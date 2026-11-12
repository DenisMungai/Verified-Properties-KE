/**
 * Accessibility checks for the S22 audit (prompt decision 8). Each returns plain findings so a
 * spec can report every problem on a page at once instead of stopping at the first.
 */
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

/**
 * Accepted axe exceptions: rule id -> selector substring and the reason. Keep this empty unless
 * the owner has confirmed the exception (docs/QUALITY_REPORT.md lists each one).
 */
const ACCEPTED: { rule: string; target: string; reason: string }[] = [
  {
    rule: "color-contrast",
    target: "nextjs-portal",
    reason: "The Next.js dev-tools badge exists only in `next dev`, never in a production build.",
  },
];

export interface AxeFinding {
  rule: string;
  impact: string;
  help: string;
  targets: string[];
}

export async function axeFindings(page: Page): Promise<AxeFinding[]> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude("nextjs-portal").analyze();
  return result.violations
    .map((v) => ({
      rule: v.id,
      impact: v.impact ?? "unknown",
      help: v.help,
      targets: v.nodes
        .map((n) => n.target.join(" "))
        .filter((t) => !ACCEPTED.some((a) => a.rule === v.id && t.includes(a.target))),
    }))
    .filter((f) => f.targets.length > 0);
}

/** Wider-than-viewport content (horizontal page scroll), with the widest offenders. */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    if (doc.scrollWidth <= doc.clientWidth + 1) return [];
    const limit = doc.clientWidth;
    const offenders: string[] = [];
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>("*"))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.right <= limit + 1) continue;
      // Report the outermost offender of each subtree only.
      if (el.parentElement && el.parentElement.getBoundingClientRect().right > limit + 1) continue;
      const name = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}`;
      offenders.push(`${name} right=${Math.round(r.right)} (viewport ${limit}) "${(el.textContent ?? "").trim().slice(0, 40)}"`);
      if (offenders.length >= 5) break;
    }
    return offenders.length > 0 ? offenders : [`scrollWidth ${doc.scrollWidth} > ${doc.clientWidth}`];
  });
}

/**
 * Controls below the project's target size, in the header and main. AGENTS.md §1 sets the
 * height: 44px (`h-control`), or 32px for the documented secondary controls (pagination, sort
 * select, card heart, filter chip remove, the gallery's "View all photos" overlay). Width follows
 * WCAG 2.2 AA 2.5.8: at least 24px. An invisible ::after hit area (the chip remove) counts.
 * Exempt: inline links inside running text (the 2.5.8 inline exception) and screen-reader-only
 * elements.
 */
export async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"]';
    const scopes = Array.from(document.querySelectorAll<HTMLElement>("header, main")).filter((s) => s.offsetParent !== null || s.tagName === "MAIN");
    const findings: string[] = [];
    const seen = new Set<Element>();

    const isSecondary = (el: Element): boolean =>
      Boolean(
        el.closest('nav[aria-label="Pagination"]') ||
          el.id === "search-sort" ||
          (el.closest("article") && /saved|save listing|sign in to save/i.test(el.getAttribute("aria-label") ?? "")) ||
          el.closest('[aria-labelledby="active-filters-heading"], [data-chip]') ||
          /^Remove filter/i.test(el.getAttribute("aria-label") ?? "") ||
          /^View all \d+ photos$/.test((el.textContent ?? "").trim()),
      );

    const isInlineText = (el: HTMLElement): boolean => {
      if (el.tagName !== "A") return false;
      const style = getComputedStyle(el);
      if (style.display !== "inline") return false;
      const block = el.parentElement?.closest("p, li, dd, td, label, span, small") ?? el.parentElement;
      const text = (block?.textContent ?? "").trim();
      return text.length > (el.textContent ?? "").trim().length + 1;
    };

    for (const scope of scopes) {
      for (const el of Array.from(scope.querySelectorAll<HTMLElement>(selector))) {
        if (seen.has(el)) continue;
        seen.add(el);
        const style = getComputedStyle(el);
        if (style.visibility === "hidden" || style.display === "none") continue;
        if (el.closest("[hidden], [aria-hidden='true'], dialog:not([open]), [popover]:not(:popover-open)")) continue;
        let rect = el.getBoundingClientRect();
        if (rect.width <= 2 || rect.height <= 2) continue; // screen-reader only or collapsed
        if (rect.bottom < 0 && rect.top < 0) continue;
        // Radios and checkboxes: the label is the target.
        if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") && el.labels?.[0]) {
          const l = el.labels[0].getBoundingClientRect();
          rect = new DOMRect(Math.min(l.x, rect.x), Math.min(l.y, rect.y), Math.max(l.width, rect.width), Math.max(l.height, rect.height));
        }
        if (isInlineText(el)) continue;
        const after = getComputedStyle(el, "::after");
        if (after.content !== "none" && after.position === "absolute") {
          const aw = parseFloat(after.width) || 0;
          const ah = parseFloat(after.height) || 0;
          rect = new DOMRect(rect.x, rect.y, Math.max(rect.width, aw), Math.max(rect.height, ah));
        }
        const minHeight = isSecondary(el) ? 32 : 44;
        const minWidth = 24;
        const w = Math.round(rect.width);
        const h = Math.round(rect.height);
        if (w + 0.5 >= minWidth && h + 0.5 >= minHeight) continue;
        const name =
          el.getAttribute("aria-label") ?? (el.textContent ?? "").trim().slice(0, 40) ?? el.getAttribute("name") ?? "";
        findings.push(`${el.tagName.toLowerCase()} "${name}" ${w}×${h} (min ${minWidth}×${minHeight})`);
      }
    }
    return findings;
  });
}

/** True when the focused element (or the card/label it lives in) shows an outline or ring. */
export async function focusVisible(page: Page): Promise<{ ok: boolean; what: string }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { ok: false, what: "nothing focused" };
    const what = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`;
    const shows = (node: Element) => {
      const s = getComputedStyle(node);
      const outline = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const ring = s.boxShadow !== "none" && s.boxShadow !== "";
      return outline || ring;
    };
    let node: Element | null = el;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      if (shows(node)) return { ok: true, what };
    }
    // A label styled by :has(:focus-visible) (segmented controls, radio cards).
    const label = (el as HTMLInputElement).labels?.[0];
    if (label && shows(label)) return { ok: true, what };
    const peerLabel = el.nextElementSibling;
    if (peerLabel && shows(peerLabel)) return { ok: true, what };
    return { ok: false, what };
  });
}
