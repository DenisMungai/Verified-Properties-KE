import type { Metadata, Viewport } from "next";
import "@fontsource/poppins/latin-400.css";
import "@fontsource/poppins/latin-500.css";
import "@fontsource/poppins/latin-600.css";
import "@fontsource/poppins/latin-700.css";
// 800 is only for the logo wordmark.
import "@fontsource/poppins/latin-800.css";
import "./globals.css";
import { OverscrollTint } from "@/components/layout/OverscrollTint";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { BRAND } from "@/lib/brand";

export const metadata: Metadata = {
  title: { default: `${BRAND.name} | ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
};

// White, to match the solid header (a green browser bar showed as a band above it on iPhones).
export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // data-scroll-behavior: Next turns smooth scrolling off during route changes (globals.css sets it on html).
    <html lang="en-KE" data-scroll-behavior="smooth">
      <body className="flex min-h-dvh flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-line focus:bg-white focus:px-4 focus:py-2 focus:text-small focus:font-semibold focus:text-ink"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
        <SiteFooter />
        <OverscrollTint />
      </body>
    </html>
  );
}
