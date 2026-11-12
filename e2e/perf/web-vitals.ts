/**
 * S22 performance pass (prompt decision 9): LCP and CLS for home, search and a listing page,
 * desktop and mobile, measured in Edge with a PerformanceObserver. Read-only page loads: no
 * sign-in, no forms, no payments, so it is safe against the live site.
 *
 *   node --import tsx e2e/perf/web-vitals.ts https://verifiedpropertieske.vercel.app [listing-slug] [runs]
 *
 * Mobile runs use a 390px viewport, 4x CPU slowdown and a "fast 4G" network profile.
 */
import { chromium, type Browser, type BrowserContext } from "@playwright/test";

interface Sample {
  lcpMs: number | null;
  lcpElement: string;
  cls: number;
  shifts: string[];
  ttfbMs: number;
}

const base = (process.argv[2] ?? "https://verifiedpropertieske.vercel.app").replace(/\/+$/, "");
const slug = process.argv[3];
const runs = Number(process.argv[4] ?? 3);

const OBSERVE = () => {
  const w = window as unknown as { __vitals: { lcp: number | null; lcpEl: string; cls: number; shifts: string[] } };
  w.__vitals = { lcp: null, lcpEl: "", cls: 0, shifts: [] };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & { element?: Element; url?: string })[]) {
      w.__vitals.lcp = entry.startTime;
      const el = entry.element;
      w.__vitals.lcpEl = el ? `${el.tagName.toLowerCase()}${entry.url ? ` ${entry.url.split("?")[0].slice(-60)}` : ""}` : "";
    }
  }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries() as (PerformanceEntry & {
      value: number;
      hadRecentInput: boolean;
      sources?: { node?: Node }[];
    })[]) {
      if (entry.hadRecentInput) continue;
      w.__vitals.cls += entry.value;
      const node = entry.sources?.[0]?.node as Element | undefined;
      if (entry.value > 0.001) {
        w.__vitals.shifts.push(
          `${entry.value.toFixed(3)} ${node?.tagName?.toLowerCase() ?? "?"}${node && "className" in node ? `.${String(node.className).split(" ").slice(0, 3).join(".")}` : ""}`,
        );
      }
    }
  }).observe({ type: "layout-shift", buffered: true });
};

async function measure(context: BrowserContext, url: string, mobile: boolean): Promise<Sample> {
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (mobile) {
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    // Lighthouse-like "fast 4G": 150ms RTT, ~1.6 Mbps down, ~750 Kbps up.
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 150,
      downloadThroughput: (1.6 * 1024 * 1024) / 8,
      uploadThroughput: (750 * 1024) / 8,
    });
  }
  await page.addInitScript(OBSERVE);
  await page.goto(url, { waitUntil: "load", timeout: 120_000 });
  await page.waitForTimeout(5_000);
  const v = await page.evaluate(() => {
    const w = window as unknown as { __vitals: { lcp: number | null; lcpEl: string; cls: number; shifts: string[] } };
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return { ...w.__vitals, ttfb: nav ? nav.responseStart : 0 };
  });
  await page.close();
  return { lcpMs: v.lcp, lcpElement: v.lcpEl, cls: v.cls, shifts: v.shifts, ttfbMs: v.ttfb };
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function main(): Promise<void> {
  const browser: Browser = await chromium.launch({ channel: "msedge" });
  const pages = [
    ["home", "/"],
    ["search", "/properties?mode=rent"],
    ...(slug ? [["listing", `/properties/${slug}`]] : []),
  ];
  const rows: Record<string, string | number>[] = [];
  for (const mobile of [false, true]) {
    const context = await browser.newContext(
      mobile
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
        : { viewport: { width: 1280, height: 800 } },
    );
    for (const [name, path] of pages) {
      const samples: Sample[] = [];
      for (let i = 0; i < runs; i++) samples.push(await measure(context, `${base}${path}`, mobile));
      const worst = samples.reduce((a, b) => (b.cls > a.cls ? b : a));
      rows.push({
        page: name,
        device: mobile ? "mobile" : "desktop",
        "LCP median ms": Math.round(median(samples.map((s) => s.lcpMs ?? NaN))),
        "CLS max": Number(Math.max(...samples.map((s) => s.cls)).toFixed(3)),
        "TTFB median ms": Math.round(median(samples.map((s) => s.ttfbMs))),
        "LCP element": samples[samples.length - 1].lcpElement,
      });
      if (worst.shifts.length > 0) console.info(`[${name} ${mobile ? "mobile" : "desktop"}] shifts:`, worst.shifts.join(" | "));
    }
    await context.close();
  }
  await browser.close();
  console.table(rows);
}

void main();
