import type { Config } from "tailwindcss";

/**
 * Tokens from PropertyHub Design System v1.0 (§2, §5). The markdown tokens are the source of
 * truth (plan v2.0 §14); the design boards' emerald values are not used.
 *
 * Contrast (WCAG AA, 4.5:1 for normal text):
 *  - white on emerald-600 #14833B ≈ 4.8:1
 *  - slate-600 #687280 on canvas ≈ 4.5:1, on white ≈ 4.9:1
 *  - slate-500 #87919E fails for text: placeholders and decorative icons only.
 */
const config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        navy: { 950: "#0B1F3A", 900: "#102746", 800: "#163B63", 700: "#24517A" },
        emerald: { 700: "#087443", 600: "#14833B", 500: "#1C9950" },
        mint: { 50: "#F1F8F3", 100: "#E4F2E8" },
        canvas: "#F7F7F3",
        ink: "#171B22",
        slate: { 700: "#475569", 600: "#687280", 500: "#87919E" },
        line: { DEFAULT: "#DCE4E2", strong: "#C7D2D0" },
        "surface-muted": "#EEF2F0",
        success: "#087443",
        warning: "#A96508",
        danger: "#B42318",
        info: "#175CD3",
        sand: { 500: "#D7B982" },
      },
      fontFamily: {
        sans: ["Poppins", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      fontSize: {
        display: ["2.5rem", { lineHeight: "3rem", letterSpacing: "-0.035em", fontWeight: "700" }],
        "display-sm": ["2rem", { lineHeight: "2.5rem", letterSpacing: "-0.035em", fontWeight: "700" }],
        h1: ["2rem", { lineHeight: "2.5rem", letterSpacing: "-0.025em", fontWeight: "700" }],
        "h1-sm": ["1.75rem", { lineHeight: "2.25rem", letterSpacing: "-0.025em", fontWeight: "700" }],
        h2: ["1.5rem", { lineHeight: "2rem", letterSpacing: "-0.02em", fontWeight: "700" }],
        h3: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.01em", fontWeight: "600" }],
        h4: ["1.125rem", { lineHeight: "1.625rem", fontWeight: "600" }],
        "body-lg": ["1.125rem", { lineHeight: "1.8125rem" }],
        body: ["1rem", { lineHeight: "1.5rem" }],
        "body-sm": ["0.875rem", { lineHeight: "1.3125rem" }],
        label: ["0.75rem", { lineHeight: "1.0625rem", letterSpacing: "0.06em", fontWeight: "600" }],
        caption: ["0.75rem", { lineHeight: "1.125rem" }],
        button: ["0.875rem", { lineHeight: "1.25rem", fontWeight: "600" }],
        price: ["1.25rem", { lineHeight: "1.75rem", letterSpacing: "-0.02em", fontWeight: "700" }],
      },
      borderRadius: {
        sm: "0.5rem",
        md: "0.75rem",
        lg: "1rem",
        xl: "1.25rem",
        "2xl": "1.5rem",
        pill: "9999px",
      },
      boxShadow: {
        card: "0 8px 24px rgb(11 31 58 / 6%)",
        popover: "0 16px 40px rgb(11 31 58 / 14%)",
        focus: "0 0 0 3px rgb(20 131 59 / 22%)",
      },
      // On the spacing scale so h-, w-, size- and min-w- utilities all accept them.
      spacing: { control: "2.75rem", "control-lg": "3rem", header: "4.5rem" },
      maxWidth: { container: "80rem", prose: "65ch", modal: "35rem" },
    },
  },
  plugins: [],
} satisfies Config;

export default config;
