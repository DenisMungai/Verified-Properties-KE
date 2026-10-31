import type { Config } from "tailwindcss";

/**
 * Tokens from the VerifiedPropertiesKE UI design (design/…/VerifiedPropertiesKE — Design System):
 * Forest #14833B, Deep green #087443, Soft green #E8F4EC, Warm canvas #F7F8F5, Charcoal #17231D,
 * Muted #647168, Border #E1E7E2, Warning #B7791F, Error #B42318. The CSS root is 90% (globals.css),
 * so rem-based sizes render at 0.9×; touch targets are set in px so they stay ≥44px.
 *
 * Contrast (WCAG AA):
 *  - white on emerald-600 ≈ 4.8:1; slate-600 (muted) on canvas ≈ 4.8:1
 *  - line-strong #8C968F ≈ 3:1 on white: form-control borders only (WCAG 1.4.11)
 *  - warning #B7791F ≈ 3.6:1 on white: icons and tints only; warning text uses warning-text
 *  - slate-500 fails for text: placeholders and decorative icons only
 */
const config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        emerald: { 700: "#087443", 600: "#14833B", 500: "#1C9950" },
        mint: { 50: "#E8F4EC", 100: "#DCEDE2" },
        canvas: "#F7F8F5",
        ink: "#17231D",
        slate: { 700: "#4A564F", 600: "#647168", 500: "#8C968F" },
        line: { DEFAULT: "#E1E7E2", strong: "#8C968F" },
        "surface-muted": "#EEF2EF",
        success: "#087443",
        warning: { DEFAULT: "#B7791F", text: "#8A5206", tint: "#FDF3E1" },
        danger: { DEFAULT: "#B42318", tint: "#FDECEA" },
        info: "#175CD3",
        sand: { 500: "#E8DFD3" },
      },
      fontFamily: {
        sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      /*
       * Compact scale: ~90% of the UI is `small` / `micro`; only headlines are large. At the 90% root:
       * display ≈ 50px, display-sm ≈ 32px, title ≈ 16px, body ≈ 12.6px, small ≈ 10.8px, micro ≈ 9px.
       */
      fontSize: {
        display: ["3.5rem", { lineHeight: "1.02", letterSpacing: "-0.055em", fontWeight: "700" }],
        "display-sm": ["2.25rem", { lineHeight: "1.05", letterSpacing: "-0.045em", fontWeight: "700" }],
        title: ["1.125rem", { lineHeight: "1.5rem", fontWeight: "600" }],
        body: ["0.875rem", { lineHeight: "1.5rem" }],
        small: ["0.75rem", { lineHeight: "1.15rem" }],
        micro: ["0.625rem", { lineHeight: "0.9rem", letterSpacing: "0.02em" }],
      },
      // Radius: Tailwind defaults (sm 2px, DEFAULT 4px, md 6px, lg 8px, xl 12px, full).
      // Borders separate surfaces; the only drop shadow is `shadow-sm` on card hover.
      boxShadow: {
        focus: "0 0 0 3px rgb(20 131 59 / 22%)",
      },
      // Touch targets in px so the 90% root never shrinks them below 44px. On the spacing scale
      // so h-, w-, size- and min-w- utilities all accept them.
      spacing: { control: "44px", "control-lg": "48px", gutter: "1rem", sidebar: "17.5rem", "page-x": "4vw" },
      maxWidth: { page: "1440px", text: "1160px", prose: "65ch", modal: "35rem" },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
